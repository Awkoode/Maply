require('dotenv').config();
const express = require('express');
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

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query('SELECT id, nome, email, bairro FROM users WHERE id = $1', [payload.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'Não autorizado' });
    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    bairro: user.bairro
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
    'INSERT INTO users (nome, email, bairro, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, bairro',
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

  const result = await query('SELECT id, nome, email, bairro, password_hash FROM users WHERE email = $1', [email]);
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

app.get('/api/ocorrencias/public', async (req, res) => {
  const result = await query('SELECT id, tipo, descricao, local, bairro, status, data, votos, cep, logradouro, complemento, localidade, uf FROM ocorrencias ORDER BY data DESC');
  res.json(result.rows);
});

app.get('/api/ocorrencias', authMiddleware, async (req, res) => {
  const result = await query('SELECT id, tipo, descricao, local, bairro, status, data, votos, cep, logradouro, complemento, localidade, uf FROM ocorrencias ORDER BY data DESC');
  res.json(result.rows);
});

app.get('/api/ocorrencias/:id', authMiddleware, async (req, res) => {
  const result = await query('SELECT id, tipo, descricao, local, bairro, status, data, votos, cep, logradouro, complemento, localidade, uf FROM ocorrencias WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
  res.json(result.rows[0]);
});

app.post('/api/ocorrencias', authMiddleware, async (req, res) => {
  const { tipo, descricao, local, bairro, status, data, cep, logradouro, localidade, uf, complemento } = req.body;
  if (!tipo || !descricao || !local || (!bairro && !cep) || !status || !data) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

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
    return res.status(400).json({ error: 'NÃ£o foi possÃ­vel identificar a localizaÃ§Ã£o' });
  }

  const result = await query(
    `INSERT INTO ocorrencias (tipo, descricao, local, bairro, status, data, votos, cep, logradouro, complemento, localidade, uf, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12)
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
      req.user.id
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

app.use(express.static(path.join(__dirname, '.')));

app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
