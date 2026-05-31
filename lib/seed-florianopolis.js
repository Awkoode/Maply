/**
 * Ocorrências de exemplo — Florianópolis (~50)
 * Marcador na descrição para evitar duplicação ao reiniciar o servidor.
 */
const SEED_MARKER = '[Maply demo Florianópolis]';

const TIPOS = [
  'Buraco na via',
  'Semáforo quebrado',
  'Sinalização ausente',
  'Alagamento',
  'Obra sem sinalização',
  'Lixo na pista',
  'Acidente registrado',
  'Iluminação pública',
  'Pavimento danificado',
  'Calçada obstruída'
];

const BAIRROS = [
  { bairro: 'Centro', localidade: 'Florianópolis', uf: 'SC', lat: -27.5969, lon: -48.5495 },
  { bairro: 'Trindade', localidade: 'Florianópolis', uf: 'SC', lat: -27.5990, lon: -48.5200 },
  { bairro: 'Lagoa da Conceição', localidade: 'Florianópolis', uf: 'SC', lat: -27.6022, lon: -48.4680 },
  { bairro: 'Ingleses', localidade: 'Florianópolis', uf: 'SC', lat: -27.4205, lon: -48.4020 },
  { bairro: 'Campeche', localidade: 'Florianópolis', uf: 'SC', lat: -27.6910, lon: -48.5080 },
  { bairro: 'Agronômica', localidade: 'Florianópolis', uf: 'SC', lat: -27.5750, lon: -48.5180 },
  { bairro: 'Coqueiros', localidade: 'Florianópolis', uf: 'SC', lat: -27.6080, lon: -48.5820 },
  { bairro: 'Estreito', localidade: 'Florianópolis', uf: 'SC', lat: -27.5850, lon: -48.5920 },
  { bairro: 'Saco dos Limões', localidade: 'Florianópolis', uf: 'SC', lat: -27.6120, lon: -48.5350 },
  { bairro: 'Córrego Grande', localidade: 'Florianópolis', uf: 'SC', lat: -27.5980, lon: -48.5050 },
  { bairro: 'Itacorubi', localidade: 'Florianópolis', uf: 'SC', lat: -27.5880, lon: -48.5120 },
  { bairro: 'Barra da Lagoa', localidade: 'Florianópolis', uf: 'SC', lat: -27.5750, lon: -48.4280 },
  { bairro: 'Rio Tavares', localidade: 'Florianópolis', uf: 'SC', lat: -27.6550, lon: -48.4850 },
  { bairro: 'Santo Antônio de Lisboa', localidade: 'Florianópolis', uf: 'SC', lat: -27.5150, lon: -48.5120 },
  { bairro: 'Canasvieiras', localidade: 'Florianópolis', uf: 'SC', lat: -27.3950, lon: -48.4520 }
];

const LOGRADOUROS = [
  'Av. Beira-Mar Norte',
  'Av. Mauro Ramos',
  'Rua Felipe Schmidt',
  'Av. Eng. Maximiliano Gomes Rocha',
  'Rua Deputado Antônio Edu Vieira',
  'Av. Madre Benvenuta',
  'Rua João Pio Duarte Silva',
  'Av. das Rendeiras',
  'Rua Lauro Linhares',
  'Av. Prefeito Osmar Cunha'
];

const STATUSES = ['aberto', 'aberto', 'aberto', 'analise', 'analise', 'resolvido'];
const SEVERIDADES = ['media', 'media', 'alta', 'alta', 'baixa', 'media', 'alta'];

function buildSamples() {
  const samples = [];
  for (let i = 1; i <= 50; i++) {
    const loc = BAIRROS[(i - 1) % BAIRROS.length];
    const tipo = TIPOS[(i * 3) % TIPOS.length];
    const log = LOGRADOUROS[(i * 2) % LOGRADOUROS.length];
    const jitterLat = ((i % 17) - 8) / 2500;
    const jitterLon = (((i * 7) % 17) - 8) / 2500;
    const num = 100 + (i * 37) % 900;

    samples.push({
      tipo,
      descricao: `${SEED_MARKER} Ocorrência de exemplo em ${loc.bairro}: ${tipo.toLowerCase()} reportada por cidadão.`,
      local: `${log}, ${num} — ${loc.bairro}`,
      bairro: loc.bairro,
      status: STATUSES[i % STATUSES.length],
      data: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
      cep: `880${String(10 + (i % 80)).padStart(2, '0')}${String(100 + i).slice(-3)}`,
      logradouro: log,
      localidade: loc.localidade,
      uf: loc.uf,
      severidade: SEVERIDADES[i % SEVERIDADES.length],
      lat: Math.round((loc.lat + jitterLat) * 10000) / 10000,
      lon: Math.round((loc.lon + jitterLon) * 10000) / 10000
    });
  }
  return samples;
}

const SAMPLES = buildSamples();

async function getSeedUserId(query, bcrypt) {
  const existing = await query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  if (existing.rows.length) return existing.rows[0].id;

  const password_hash = await bcrypt.hash('maply-seed-internal', 10);
  try {
    const ins = await query(
      `INSERT INTO users (nome, email, bairro, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Maply Exemplos', 'exemplos@maply.local', 'Centro', password_hash]
    );
    if (ins.rows.length) return ins.rows[0].id;
  } catch {
    const again = await query('SELECT id FROM users WHERE email = $1', ['exemplos@maply.local']);
    if (again.rows.length) return again.rows[0].id;
  }
  return null;
}

async function ensureSampleOcorrencias(query, bcrypt) {
  const countRes = await query(
    `SELECT COUNT(*)::int AS c FROM ocorrencias WHERE descricao LIKE $1`,
    [`%${SEED_MARKER}%`]
  );
  const count = countRes.rows[0]?.c || 0;
  if (count >= 45) {
    return { inserted: 0, skipped: true, existing: count };
  }

  const userId = await getSeedUserId(query, bcrypt);
  let inserted = 0;

  for (const s of SAMPLES) {
    const exists = await query(
      'SELECT id FROM ocorrencias WHERE descricao = $1 AND local = $2 LIMIT 1',
      [s.descricao, s.local]
    );
    if (exists.rows.length) continue;

    await query(
      `INSERT INTO ocorrencias (
         tipo, descricao, local, bairro, status, data, votos,
         cep, logradouro, complemento, localidade, uf, user_id,
         severidade, lat, lon, criado_em
       )
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, NULL, $9, $10, $11, $12, $13, $14, NOW())`,
      [
        s.tipo,
        s.descricao,
        s.local,
        s.bairro,
        s.status,
        s.data,
        s.cep,
        s.logradouro,
        s.localidade,
        s.uf,
        userId,
        s.severidade,
        s.lat,
        s.lon
      ]
    );
    inserted++;
  }

  return { inserted, skipped: false, existing: count + inserted };
}

module.exports = { ensureSampleOcorrencias, SAMPLES };
