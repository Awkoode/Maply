const fetch = require('node-fetch');

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
const CACHE_TTL_MS = 60_000;
const MAX_BBOX_KM2 = 9500;

const serverCache = new Map();

const FIELDS_PARAM = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,iconCategory},from,to,delay,length}}}';

const ICON_LABELS = {
  0: 'Desconhecido',
  1: 'Acidente',
  2: 'Neblina',
  3: 'Condição perigosa',
  4: 'Chuva',
  5: 'Gelo',
  6: 'Congestionamento',
  7: 'Faixa fechada',
  8: 'Via bloqueada',
  9: 'Obra',
  10: 'Vento',
  11: 'Alagamento',
  14: 'Veículo quebrado'
};

function isEnabled() {
  return !!TOMTOM_API_KEY;
}

function getZoomTier(zoom) {
  const z = Math.round(zoom);
  if (z <= 9) return 'low';
  if (z <= 13) return 'medium';
  return 'high';
}

function clampBbox(minLon, minLat, maxLon, maxLat) {
  const midLat = (minLat + maxLat) / 2;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos((midLat * Math.PI) / 180);
  const widthKm = Math.abs(maxLon - minLon) * kmPerDegLon;
  const heightKm = Math.abs(maxLat - minLat) * kmPerDegLat;
  const area = widthKm * heightKm;

  if (area <= MAX_BBOX_KM2) {
    return { minLon, minLat, maxLon, maxLat, clamped: false };
  }

  const scale = Math.sqrt(MAX_BBOX_KM2 / area);
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const halfW = ((maxLon - minLon) / 2) * scale;
  const halfH = ((maxLat - minLat) / 2) * scale;

  return {
    minLon: centerLon - halfW,
    minLat: centerLat - halfH,
    maxLon: centerLon + halfW,
    maxLat: centerLat + halfH,
    clamped: true
  };
}

function incidentPriority(inc) {
  const cat = inc.properties?.iconCategory ?? 0;
  const mag = inc.properties?.magnitudeOfDelay ?? 0;
  const delay = inc.properties?.delay ?? 0;

  if (cat === 1 && (mag >= 3 || delay >= 600)) return 100;
  if (cat === 8) return 95;
  if (cat === 6 && mag >= 3) return 85;
  if (cat === 7) return 75;
  if (cat === 9) return 65;
  if (cat === 1) return 55;
  if (cat === 6 && mag >= 2) return 45;
  if (cat === 6) return 35;
  if (cat === 3 || cat === 11) return 25;
  return 10;
}

function passesZoomFilter(inc, tier) {
  const cat = inc.properties?.iconCategory ?? 0;
  const mag = inc.properties?.magnitudeOfDelay ?? 0;
  const delay = inc.properties?.delay ?? 0;

  if (tier === 'low') {
    if (cat === 8) return true;
    if (cat === 1) return mag >= 3 || delay >= 300;
    if (cat === 6) return mag >= 3;
    return false;
  }

  if (tier === 'medium') {
    if ([1, 7, 8, 9].includes(cat)) return true;
    if (cat === 6) return mag >= 2;
    return false;
  }

  return true;
}

function simplifyCoords(coords, maxPoints) {
  if (!coords || coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const out = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
  const last = coords[coords.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function normalizeIncident(feature, tier) {
  const props = feature.properties || {};
  const geom = feature.geometry || {};
  let coordinates = geom.coordinates;

  if (geom.type === 'LineString' && Array.isArray(coordinates)) {
    const maxPts = tier === 'high' ? 80 : tier === 'medium' ? 40 : 20;
    coordinates = simplifyCoords(coordinates, maxPts);
  }

  const desc = props.events?.[0]?.description || ICON_LABELS[props.iconCategory] || 'Incidente';

  return {
    id: props.id,
    type: geom.type,
    coordinates,
    iconCategory: props.iconCategory,
    magnitudeOfDelay: props.magnitudeOfDelay,
    label: ICON_LABELS[props.iconCategory] || 'Incidente',
    description: desc,
    from: props.from,
    to: props.to,
    delay: props.delay,
    length: props.length,
    priority: incidentPriority(feature)
  };
}

function filterAndLimitIncidents(incidents, tier) {
  const limits = { low: 35, medium: 100, high: 250 };

  return incidents
    .filter(inc => passesZoomFilter(inc, tier))
    .sort((a, b) => incidentPriority(b) - incidentPriority(a))
    .slice(0, limits[tier])
    .map(inc => normalizeIncident(inc, tier));
}

function cacheKey(bbox, tier) {
  const r = (n) => Math.round(n * 1000) / 1000;
  return `${tier}:${r(bbox.minLon)},${r(bbox.minLat)},${r(bbox.maxLon)},${r(bbox.maxLat)}`;
}

function getFromCache(key) {
  const hit = serverCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    serverCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data) {
  serverCache.set(key, { ts: Date.now(), data });
  if (serverCache.size > 200) {
    const oldest = serverCache.keys().next().value;
    serverCache.delete(oldest);
  }
}

async function fetchIncidentsFromTomTom(bbox) {
  const bboxStr = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
  const url = new URL('https://api.tomtom.com/traffic/services/5/incidentDetails');
  url.searchParams.set('key', TOMTOM_API_KEY);
  url.searchParams.set('bbox', bboxStr);
  url.searchParams.set('fields', FIELDS_PARAM);
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('timeValidityFilter', 'present');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TomTom incidentDetails ${res.status}: ${text.slice(0, 120)}`);
  }

  const body = await res.json();
  return body.incidents || [];
}

async function getTrafficForViewport({ minLon, minLat, maxLon, maxLat, zoom }) {
  if (!isEnabled()) {
    return { enabled: false, items: [], tier: getZoomTier(zoom), flow: null };
  }

  const tier = getZoomTier(zoom);
  const bbox = clampBbox(
    parseFloat(minLon),
    parseFloat(minLat),
    parseFloat(maxLon),
    parseFloat(maxLat)
  );

  const key = cacheKey(bbox, tier);
  const cached = getFromCache(key);
  if (cached) return { ...cached, cached: true };

  const raw = await fetchIncidentsFromTomTom(bbox);
  const items = filterAndLimitIncidents(raw, tier);

  const flowStyle = tier === 'low' ? 'reduced-sensitivity' : 'relative0-dark';
  const flowMinZoom = tier === 'low' ? 8 : 10;
  const flowThickness = tier === 'high' ? 6 : tier === 'medium' ? 4 : 3;

  const payload = {
    enabled: true,
    cached: false,
    tier,
    bbox,
    items,
    flow: {
      tileUrl: getFlowTileUrl(flowStyle, flowThickness),
      style: flowStyle,
      minZoom: flowMinZoom,
      thickness: flowThickness
    },
    legend: [
      { color: '#30a860', label: 'Fluxo normal' },
      { color: '#ffd600', label: 'Moderado' },
      { color: '#ff9100', label: 'Intenso' },
      { color: '#e53935', label: 'Severo' },
      { color: '#7b001c', label: 'Crítico' }
    ]
  };

  setCache(key, payload);
  return payload;
}

function getFlowTileUrl(style, thickness) {
  if (!isEnabled()) return null;
  return `https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}&thickness=${thickness}`;
}

module.exports = {
  isEnabled,
  getTrafficForViewport,
  getFlowTileUrl,
  getZoomTier
};
