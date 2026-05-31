require('dotenv').config();
const express = require('express');
const { getTrafficForViewport, getFlowTileUrl, isEnabled: tomtomEnabled } = require('./lib/tomtom-traffic');
const { ensureSampleOcorrencias } = require('./lib/seed-florianopolis');
const { buildPremiumReport } = require('./lib/premium-report');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'maply_secret_key';
const PORT = process.env.PORT || 3000;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL no arquivo .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

function createToken(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
}

const USER_FIELDS = 'id, nome, email, bairro, assinatura_ativa, assinatura_expira_em, plano';

function userHasActiveSubscription(user) {
  if (!user || !user.assinatura_ativa) return false;
  if (user.assinatura_expira_em && new Date(user.assinatura_expira_em) <= new Date()) return false;
  return true;
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [payload.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'Não autorizado' });
    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function sanitizeUser(user) {
  const assinatura_ativa = userHasActiveSubscription(user);
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    bairro: user.bairro,
    assinatura_ativa,
    assinatura_expira_em: user.assinatura_expira_em || null,
    plano: assinatura_ativa ? (user.plano || 'premium') : 'gratuito'
  };
}

const OC_FIELDS = 'id, tipo, descricao, local, bairro, status, data, votos, cep, logradouro, complemento, localidade, uf, severidade, lat, lon, criado_em, user_id';

async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [payload.userId]);
    req.user = result.rows.length ? result.rows[0] : null;
  } catch {
    req.user = null;
  }
  next();
}

function blurCoords(lat, lon, id) {
  const seed = parseInt(String(id).replace(/\D/g, ''), 10) || 1;
  const offsetLat = ((seed % 100) - 50) / 4000;
  const offsetLon = (((seed * 13) % 100) - 50) / 4000;
  return [
    Math.round((parseFloat(lat) + offsetLat) * 1000) / 1000,
    Math.round((parseFloat(lon) + offsetLon) * 1000) / 1000
  ];
}

function formatOccurrenceForMap(row, exactLocation) {
  const base = {
    id: row.id,
    tipo: row.tipo,
    bairro: row.bairro,
    status: row.status,
    severidade: row.severidade || 'media',
    local_aproximado: !exactLocation
  };

  if (!row.lat || !row.lon) return { ...base, lat: null, lon: null };

  if (exactLocation) {
    return {
      ...base,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      local: row.local
    };
  }

  const [lat, lon] = blurCoords(row.lat, row.lon, row.id);
  return { ...base, lat, lon, local: row.bairro };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function geocodeAddress(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return null;

  const searchQ = /brasil/i.test(q) ? q : `${q}, Brasil`;
  const params = new URLSearchParams({
    q: searchQ,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'br',
    'accept-language': 'pt-BR'
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'Maply/1.0 (hackathon)' }
    });

    if (!response.ok) return null;
    const body = await response.json();
    if (!body.length) return null;

    const lat = parseFloat(body[0].lat);
    const lon = parseFloat(body[0].lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

    return { lat, lon };
  } catch {
    return null;
  }
}

function buildGeocodeQueries(row) {
  const local = row.local || '';
  const log = row.logradouro || '';
  const bairro = row.bairro || '';
  const cidade = row.localidade || '';
  const uf = row.uf || '';
  const cep = row.cep ? String(row.cep).replace(/\D/g, '') : '';

  const unique = new Set();
  const add = (parts) => {
    const s = parts.filter(Boolean).join(', ').trim();
    if (s.length >= 5) unique.add(s);
  };

  add([local, log, bairro, cidade, uf]);
  add([log, local, bairro, cidade, uf]);
  add([log, bairro, cidade, uf]);
  add([bairro, cidade, uf]);
  add([cidade, uf]);
  if (cep.length === 8) add([`${cep.slice(0, 5)}-${cep.slice(5)}`, cidade, uf]);

  return [...unique];
}

function fallbackCoords(row) {
  const cidade = String(row.localidade || row.bairro || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const centers = {
    'florianopolis': [-27.5954, -48.5480],
    'sao paulo': [-23.5505, -46.6333],
    'rio de janeiro': [-22.9068, -43.1729],
    'curitiba': [-25.4284, -49.2733],
    'belo horizonte': [-19.9167, -43.9345],
    'porto alegre': [-30.0346, -51.2177],
    'brasilia': [-15.7939, -47.8828],
    'salvador': [-12.9714, -38.5014],
    'recife': [-8.0476, -34.8770],
    'fortaleza': [-3.7172, -38.5433]
  };

  for (const [name, coords] of Object.entries(centers)) {
    if (cidade.includes(name)) {
      const seed = parseInt(String(row.id).replace(/\D/g, ''), 10) || 1;
      return [
        coords[0] + ((seed % 40) - 20) / 800,
        coords[1] + (((seed * 7) % 40) - 20) / 800
      ];
    }
  }

  const seed = parseInt(String(row.id).replace(/\D/g, ''), 10) || 1;
  return [
    -23.5505 + ((seed % 60) - 30) / 400,
    -46.6333 + (((seed * 11) % 60) - 30) / 400
  ];
}

async function resolveCoordsForOccurrence(row, { persist = true } = {}) {
  let lat = row.lat != null ? parseFloat(row.lat) : null;
  let lon = row.lon != null ? parseFloat(row.lon) : null;

  if (lat && lon && !Number.isNaN(lat) && !Number.isNaN(lon)) {
    return { lat, lon };
  }

  const queries = buildGeocodeQueries(row);
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(1100);
    const geo = await geocodeAddress(queries[i]);
    if (geo) {
      if (persist && row.id) {
        await query('UPDATE ocorrencias SET lat = $1, lon = $2 WHERE id = $3', [geo.lat, geo.lon, row.id]);
      }
      return geo;
    }
  }

  const fb = fallbackCoords(row);
  if (persist && row.id) {
    await query('UPDATE ocorrencias SET lat = $1, lon = $2 WHERE id = $3', [fb[0], fb[1], row.id]);
  }
  return { lat: fb[0], lon: fb[1] };
}

async function getOccurrenceQuota(userId, subscribed) {
  if (subscribed) {
    return { canCreate: true, unlimited: true, nextAvailableAt: null, remainingMs: 0 };
  }

  const result = await query(
    `SELECT criado_em FROM ocorrencias
     WHERE user_id = $1
     ORDER BY criado_em DESC
     LIMIT 1`,
    [userId]
  );

  if (!result.rows.length) {
    return { canCreate: true, unlimited: false, nextAvailableAt: null, remainingMs: 0 };
  }

  const last = new Date(result.rows[0].criado_em);
  const next = new Date(last.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();

  if (now >= next) {
    return { canCreate: true, unlimited: false, nextAvailableAt: null, remainingMs: 0 };
  }

  return {
    canCreate: false,
    unlimited: false,
    nextAvailableAt: next.toISOString(),
    remainingMs: next.getTime() - now.getTime()
  };
}

function normalizeAddressFromCep(data) {
  return {
    cep: data.cep ? String(data.cep).replace(/\D/g, '') : null,
    logradouro: data.logradouro || null,
    bairro: data.bairro || data.localidade || null,
    localidade: data.localidade || null,
    uf: data.uf || null,
    complemento: data.complemento || null,
    display: [
      data.logradouro,
      data.bairro,
      data.localidade && data.uf ? `${data.localidade}/${data.uf}` : data.localidade || data.uf
    ].filter(Boolean).join(' - ')
  };
}

function normalizeAddressFromNominatim(place) {
  const a = place.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || null;
  const road = a.road || a.pedestrian || a.footway || a.path || a.neighbourhood || place.name || null;
  const bairro = a.suburb || a.neighbourhood || a.city_district || a.quarter || city;
  const postcode = a.postcode ? String(a.postcode).replace(/\D/g, '') : null;

  return {
    cep: postcode && postcode.length === 8 ? postcode : null,
    logradouro: road,
    bairro,
    localidade: city,
    uf: a.state_code || a.state || null,
    complemento: null,
    display: place.display_name,
    lat: place.lat || null,
    lon: place.lon || null
  };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha, bairro, cep } = req.body;
  if (!nome || !email || !senha || (!bairro && !cep)) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  let resolvedBairro = bairro;
  if (!resolvedBairro && cep) {
    const cleanCep = String(cep).replace(/\D/g, '');
    if (cleanCep.length !== 8) {
      return res.status(400).json({ error: 'CEP invalido' });
    }

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      const cepData = await response.json();
      if (cepData.erro) return res.status(404).json({ error: 'CEP nao encontrado' });
      resolvedBairro = cepData.bairro || cepData.localidade;
    } catch (error) {
      return res.status(500).json({ error: 'Falha ao buscar CEP' });
    }
  }

  if (!resolvedBairro) {
    return res.status(400).json({ error: 'Nao foi possivel identificar a localizacao' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    return res.status(400).json({ error: 'Email já cadastrado' });
  }

  const password_hash = await bcrypt.hash(senha, 10);
  const result = await query(
    `INSERT INTO users (nome, email, bairro, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${USER_FIELDS}`,
    [nome, email, resolvedBairro, password_hash]
  );

  const user = sanitizeUser(result.rows[0]);
  const token = createToken(user);
  res.json({ token, user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }

  const result = await query(`SELECT ${USER_FIELDS}, password_hash FROM users WHERE email = $1`, [email]);
  if (!result.rows.length) {
    return res.status(400).json({ error: 'Email ou senha incorretos' });
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(senha, user.password_hash);
  if (!match) {
    return res.status(400).json({ error: 'Email ou senha incorretos' });
  }

  const token = createToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/subscription/status', authMiddleware, (req, res) => {
  res.json({
    assinatura_ativa: userHasActiveSubscription(req.user),
    assinatura_expira_em: req.user.assinatura_expira_em || null,
    plano: userHasActiveSubscription(req.user) ? (req.user.plano || 'premium') : 'gratuito'
  });
});

app.post('/api/subscription/pay', authMiddleware, async (req, res) => {
  const expira = new Date();
  expira.setDate(expira.getDate() + 30);

  await query(
    `UPDATE users
     SET assinatura_ativa = TRUE, assinatura_expira_em = $1, plano = 'premium'
     WHERE id = $2`,
    [expira, req.user.id]
  );

  await query(
    `INSERT INTO pagamentos (user_id, valor, status, metodo) VALUES ($1, 19.90, 'aprovado', 'simulado')`,
    [req.user.id]
  );

  const result = await query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  res.json({ success: true, user: sanitizeUser(result.rows[0]) });
});

function requirePremiumMiddleware(req, res, next) {
  if (!userHasActiveSubscription(req.user)) {
    return res.status(403).json({
      error: 'Relatório detalhado exclusivo para assinantes Premium.',
      code: 'PREMIUM_REQUIRED'
    });
  }
  next();
}

app.get('/api/reports/premium', authMiddleware, requirePremiumMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT ${OC_FIELDS} FROM ocorrencias ORDER BY data DESC`
    );
    const report = buildPremiumReport(result.rows, req.query.uf);
    res.json(report);
  } catch (error) {
    console.error('Premium report error:', error.message);
    res.status(500).json({ error: 'Falha ao gerar relatório Premium' });
  }
});

app.get('/api/ocorrencias/quota', authMiddleware, async (req, res) => {
  const subscribed = userHasActiveSubscription(req.user);
  const quota = await getOccurrenceQuota(req.user.id, subscribed);
  if (!quota.canCreate && quota.nextAvailableAt) {
    quota.remainingMs = Math.max(0, new Date(quota.nextAvailableAt).getTime() - Date.now());
  }
  res.json({
    ...quota,
    assinatura_ativa: subscribed
  });
});

app.get('/api/ocorrencias/map', optionalAuthMiddleware, async (req, res) => {
  const subscribed = req.user && userHasActiveSubscription(req.user);
  let sql = `SELECT id, tipo, local, bairro, status,
             COALESCE(severidade, 'media') AS severidade,
             lat, lon, cep, logradouro, localidade, uf
             FROM ocorrencias WHERE 1=1`;

  if (!subscribed) {
    sql += ` AND COALESCE(severidade, 'media') IN ('media', 'alta')`;
  }

  sql += ' ORDER BY data DESC LIMIT 120';

  const result = await query(sql);
  const items = [];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    try {
      const coords = await resolveCoordsForOccurrence(row, { persist: true });
      if (!coords) continue;
      items.push(formatOccurrenceForMap({ ...row, lat: coords.lat, lon: coords.lon }, subscribed));
    } catch (error) {
      console.warn('Mapa: falha ao resolver coords', row.id, error.message);
    }
  }

  res.json({
    items,
    assinatura_ativa: !!subscribed,
    filtro: subscribed ? 'todas' : 'media_alta',
    localizacao: subscribed ? 'exata' : 'aproximada'
  });
});

app.get('/api/ocorrencias/public', async (req, res) => {
  const result = await query(`SELECT ${OC_FIELDS} FROM ocorrencias ORDER BY data DESC`);
  res.json(result.rows);
});

app.get('/api/ocorrencias', authMiddleware, async (req, res) => {
  const result = await query(`SELECT ${OC_FIELDS} FROM ocorrencias ORDER BY data DESC`);
  res.json(result.rows);
});

app.get('/api/ocorrencias/:id', authMiddleware, async (req, res) => {
  if (req.params.id === 'map' || req.params.id === 'quota' || req.params.id === 'public') {
    return res.status(404).json({ error: 'Ocorrência não encontrada' });
  }
  const result = await query(`SELECT ${OC_FIELDS} FROM ocorrencias WHERE id = $1`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
  res.json(result.rows[0]);
});

app.post('/api/ocorrencias', authMiddleware, async (req, res) => {
  const subscribed = userHasActiveSubscription(req.user);
  const quota = await getOccurrenceQuota(req.user.id, subscribed);

  if (!quota.canCreate) {
    return res.status(429).json({
      error: 'Limite diário atingido. Você pode registrar 1 ocorrência a cada 24 horas.',
      nextAvailableAt: quota.nextAvailableAt,
      remainingMs: quota.remainingMs
    });
  }

  const {
    tipo, descricao, local, bairro, status, data, cep, logradouro,
    localidade, uf, complemento, severidade, lat, lon
  } = req.body;

  if (!tipo || !descricao || !local || (!bairro && !cep) || !status || !data) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const sev = ['baixa', 'media', 'alta'].includes(severidade) ? severidade : 'media';

  let cepData = null;
  if (cep) {
    try {
      const cleanCep = String(cep).replace(/\D/g, '');
      const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      const body = await response.json();
      if (!body.erro) {
        cepData = body;
      }
    } catch (error) {
      console.warn('Falha ao buscar CEP', error);
    }
  }

  const normalizedAddress = cepData ? normalizeAddressFromCep(cepData) : {
    cep: cep ? String(cep).replace(/\D/g, '') : null,
    logradouro: logradouro || null,
    bairro: bairro || localidade || null,
    localidade: localidade || null,
    uf: uf || null,
    complemento: complemento || null
  };

  if (!normalizedAddress.bairro) {
    return res.status(400).json({ error: 'Não foi possível identificar a localização' });
  }

  let coordsLat = lat ? parseFloat(lat) : null;
  let coordsLon = lon ? parseFloat(lon) : null;

  if (!coordsLat || !coordsLon || Number.isNaN(coordsLat) || Number.isNaN(coordsLon)) {
    const geo = await resolveCoordsForOccurrence({
      local,
      logradouro: normalizedAddress.logradouro,
      bairro: normalizedAddress.bairro,
      localidade: normalizedAddress.localidade,
      uf: normalizedAddress.uf,
      cep: normalizedAddress.cep
    }, { persist: false });
    if (geo) {
      coordsLat = geo.lat;
      coordsLon = geo.lon;
    }
  }

  const result = await query(
    `INSERT INTO ocorrencias (
       tipo, descricao, local, bairro, status, data, votos,
       cep, logradouro, complemento, localidade, uf, user_id,
       severidade, lat, lon, criado_em
     )
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
     RETURNING id`,
    [
      tipo,
      descricao,
      local,
      normalizedAddress.bairro,
      status,
      data,
      normalizedAddress.cep,
      normalizedAddress.logradouro,
      normalizedAddress.complemento,
      normalizedAddress.localidade,
      normalizedAddress.uf,
      req.user.id,
      sev,
      coordsLat,
      coordsLon
    ]
  );

  res.json({ id: result.rows[0].id });
});

app.put('/api/ocorrencias/:id', authMiddleware, async (req, res) => {
  const { status, descricao, local } = req.body;
  if (!status || !descricao || !local) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const result = await query(
    'UPDATE ocorrencias SET status = $1, descricao = $2, local = $3 WHERE id = $4 RETURNING id',
    [status, descricao, local, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
  res.json({ success: true });
});

app.delete('/api/ocorrencias/:id', authMiddleware, async (req, res) => {
  const result = await query('DELETE FROM ocorrencias WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
  res.json({ success: true });
});

app.post('/api/ocorrencias/:id/vote', authMiddleware, async (req, res) => {
  const result = await query(
    'UPDATE ocorrencias SET votos = COALESCE(votos, 0) + 1 WHERE id = $1 RETURNING votos',
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
  res.json({ votos: result.rows[0].votos });
});

app.get('/api/cep/:cep', async (req, res) => {
  const cep = String(req.params.cep || '').replace(/\D/g, '');
  if (!cep || cep.length !== 8) {
    return res.status(400).json({ error: 'CEP inválido' });
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const body = await response.json();
    if (body.erro) return res.status(404).json({ error: 'CEP não encontrado' });
    res.json(body);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar CEP' });
  }
});

app.get('/api/enderecos/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) {
    return res.status(400).json({ error: 'Digite pelo menos 3 caracteres' });
  }

  try {
    const params = new URLSearchParams({
      q: `${q}, Brasil`,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
      countrycodes: 'br',
      'accept-language': 'pt-BR'
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'Maply/1.0 (local development)'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Falha ao buscar endereco' });
    }

    const body = await response.json();
    res.json(body.map(normalizeAddressFromNominatim).filter(item => item.logradouro || item.localidade));
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar endereco' });
  }
});

function trafficPremiumDenied(res) {
  return res.status(403).json({
    error: 'Recurso exclusivo para assinantes Premium. Assine para acessar trânsito e incidentes em tempo real.',
    code: 'PREMIUM_REQUIRED'
  });
}

app.get('/api/traffic/config', optionalAuthMiddleware, (req, res) => {
  const apiConfigured = tomtomEnabled();
  const subscribed = req.user && userHasActiveSubscription(req.user);
  const accessible = apiConfigured && subscribed;

  res.json({
    enabled: accessible,
    apiConfigured,
    subscribed: !!subscribed,
    premiumRequired: true,
    flowTileUrl: accessible ? getFlowTileUrl('relative0-dark', 4) : null
  });
});

app.get('/api/traffic/viewport', optionalAuthMiddleware, async (req, res) => {
  if (!tomtomEnabled()) {
    return res.json({ enabled: false, items: [], tier: 'low', flow: null });
  }

  if (!req.user || !userHasActiveSubscription(req.user)) {
    return trafficPremiumDenied(res);
  }

  const { minLon, minLat, maxLon, maxLat, zoom } = req.query;
  if ([minLon, minLat, maxLon, maxLat, zoom].some(v => v === undefined || v === '')) {
    return res.status(400).json({ error: 'Parâmetros bbox e zoom obrigatórios' });
  }

  try {
    const data = await getTrafficForViewport({
      minLon, minLat, maxLon, maxLat, zoom: parseFloat(zoom)
    });
    res.json(data);
  } catch (error) {
    console.error('TomTom viewport error:', error.message);
    res.status(502).json({ error: error.message || 'Falha ao buscar trânsito TomTom' });
  }
});

app.use('/api', (req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

app.use(express.static(path.join(__dirname, '.')));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Servidor iniciado em http://0.0.0.0:${PORT}`);
  console.log('Relatório Premium: GET /api/reports/premium');
  if (tomtomEnabled()) {
    console.log('TomTom Traffic API: ativa (acesso Premium no app)');
  } else {
    console.warn('TomTom Traffic API: desativada (defina TOMTOM_API_KEY no .env)');
  }
  try {
    const seed = await ensureSampleOcorrencias(query, bcrypt);
    if (seed.inserted > 0) {
      console.log(`Ocorrências de exemplo (Florianópolis): ${seed.inserted} inseridas`);
    }
  } catch (err) {
    console.warn('Seed Florianópolis:', err.message);
  }
});
