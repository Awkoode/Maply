/**
 * Maply — TomTom Traffic Layer (viewport-only, debounced, cached)
 */
const TomTomTraffic = (() => {
  const DEBOUNCE_MS = 500;
  const REFRESH_MS = 60_000;
  const MOVE_THRESHOLD = 0.12;

  const INCIDENT_COLORS = {
    1: '#ff1744',
    6: '#ff6d00',
    7: '#ff9100',
    8: '#d50000',
    9: '#ffd600',
    11: '#0288d1'
  };

  const INCIDENT_ICONS = {
    1: 'fa-car-burst',
    6: 'fa-traffic-light',
    7: 'fa-road-barrier',
    8: 'fa-ban',
    9: 'fa-hard-hat',
    11: 'fa-water'
  };

  let map = null;
  let flowLayer = null;
  let incidentLines = null;
  let incidentMarkers = null;
  let markerCluster = null;
  let debounceTimer = null;
  let refreshTimer = null;
  let lastState = null;
  let clientCache = new Map();
  let enabled = false;
  let onStatusChange = null;

  function getZoomTier(z) {
    if (z <= 9) return 'low';
    if (z <= 13) return 'medium';
    return 'high';
  }

  function bboxKey(bounds, tier) {
    const r = (n) => Math.round(n * 1000) / 1000;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return `${tier}|${r(sw.lng)},${r(sw.lat)},${r(ne.lng)},${r(ne.lat)}`;
  }

  function getCache(key) {
    const hit = clientCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > REFRESH_MS) {
      clientCache.delete(key);
      return null;
    }
    return hit.data;
  }

  function setCache(key, data) {
    clientCache.set(key, { ts: Date.now(), data });
    if (clientCache.size > 50) {
      const first = clientCache.keys().next().value;
      clientCache.delete(first);
    }
  }

  function significantChange(bounds, zoom) {
    if (!lastState) return true;
    if (Math.round(zoom) !== Math.round(lastState.zoom)) return true;
    if (getZoomTier(zoom) !== getZoomTier(lastState.zoom)) return true;

    const c = bounds.getCenter();
    const prev = lastState.center;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const spanLat = Math.abs(ne.lat - sw.lat);
    const spanLng = Math.abs(ne.lng - sw.lng);
    const dLat = Math.abs(c.lat - prev.lat);
    const dLng = Math.abs(c.lng - prev.lng);

    return dLat > spanLat * MOVE_THRESHOLD || dLng > spanLng * MOVE_THRESHOLD;
  }

  function lineColor(cat, mag) {
    if (cat === 1) return '#ff1744';
    if (cat === 8) return '#7b001c';
    if (cat === 6) return mag >= 3 ? '#e53935' : '#ff9100';
    return INCIDENT_COLORS[cat] || '#ff9100';
  }

  function clearIncidents() {
    if (incidentLines) {
      incidentLines.clearLayers();
    }
    if (markerCluster) {
      markerCluster.clearLayers();
    }
  }

  function getIncidentAnchor(coordinates, type) {
    if (type === 'Point') return [coordinates[1], coordinates[0]];
    if (type === 'LineString' && coordinates.length) {
      const mid = coordinates[Math.floor(coordinates.length / 2)];
      return [mid[1], mid[0]];
    }
    return null;
  }

  function renderIncidents(items, bounds) {
    clearIncidents();
    if (!items.length) return;

    const viewBounds = bounds.pad(0.05);

    items.forEach(item => {
      if (item.type === 'LineString' && item.coordinates?.length >= 2) {
        const latlngs = item.coordinates.map(c => [c[1], c[0]]);
        const visible = latlngs.some(ll => viewBounds.contains(ll));
        if (!visible) return;

        const poly = L.polyline(latlngs, {
          color: lineColor(item.iconCategory, item.magnitudeOfDelay),
          weight: item.iconCategory === 8 ? 5 : 4,
          opacity: 0.85,
          dashArray: item.iconCategory === 9 ? '8 6' : null
        });

        poly.bindPopup(`
          <strong>${item.label}</strong><br>
          <span style="color:var(--text-2);font-size:.82rem">${item.description || ''}</span><br>
          ${item.from ? `<span style="font-size:.78rem">${item.from}${item.to ? ' → ' + item.to : ''}</span>` : ''}
        `);
        incidentLines.addLayer(poly);
      }

      const anchor = getIncidentAnchor(item.coordinates, item.type);
      if (!anchor || !viewBounds.contains(anchor)) return;

      const iconClass = INCIDENT_ICONS[item.iconCategory] || 'fa-triangle-exclamation';
      const color = lineColor(item.iconCategory, item.magnitudeOfDelay);

      const icon = L.divIcon({
        className: 'tt-incident-icon',
        html: `<div style="background:${color};width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #0a0a0f;box-shadow:0 2px 8px rgba(0,0,0,.5)"><i class="fa-solid ${iconClass}" style="color:#fff;font-size:.7rem"></i></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker(anchor, { icon });
      marker.bindPopup(`
        <strong>${item.label}</strong><br>
        <span style="color:var(--text-2);font-size:.82rem">${item.description || ''}</span>
      `);
      markerCluster.addLayer(marker);
    });
  }

  function updateFlowLayer(flowConfig) {
    if (!flowLayer || !flowConfig) return;

    const url = flowConfig.tileUrl;
    if (flowLayer._url !== url) {
      flowLayer.setUrl(url);
    }
    flowLayer.options.minZoom = flowConfig.minZoom || 10;
    if (getZoomTier(map.getZoom()) === 'low') {
      flowLayer.options.maxZoom = 11;
    } else {
      flowLayer.options.maxZoom = 20;
    }
  }

  async function fetchTraffic(bounds, zoom) {
    const tier = getZoomTier(zoom);
    const key = bboxKey(bounds, tier);
    const cached = getCache(key);
    if (cached) return cached;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const qs = new URLSearchParams({
      minLon: sw.lng,
      minLat: sw.lat,
      maxLon: ne.lng,
      maxLat: ne.lat,
      zoom: Math.round(zoom)
    });

    const data = await api(`traffic/viewport?${qs.toString()}`);
    setCache(key, data);
    return data;
  }

  async function loadTraffic(force = false) {
    if (!enabled || !map) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom();

    if (!force && !significantChange(bounds, zoom)) return;

    lastState = { center: bounds.getCenter(), zoom };

    if (onStatusChange) onStatusChange('loading');

    try {
      const data = await fetchTraffic(bounds, zoom);

      if (data.flow) {
        updateFlowLayer(data.flow);
      }

      renderIncidents(data.items || [], bounds);

      if (onStatusChange) {
        onStatusChange('ready', {
          count: (data.items || []).length,
          tier: data.tier,
          cached: data.cached
        });
      }
    } catch (e) {
      if (onStatusChange) onStatusChange('error', { message: e.message });
    }
  }

  function scheduleLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadTraffic(false), DEBOUNCE_MS);
  }

  function init(leafletMap, options = {}) {
    map = leafletMap;
    onStatusChange = options.onStatusChange || null;

    incidentLines = L.layerGroup().addTo(map);
    incidentMarkers = L.layerGroup().addTo(map);

    if (typeof L.markerClusterGroup === 'function') {
      markerCluster = L.markerClusterGroup({
        maxClusterRadius: 50,
        disableClusteringAtZoom: 15,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        iconCreateFunction(cluster) {
          const n = cluster.getChildCount();
          return L.divIcon({
            html: `<div style="background:#e53935;color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;border:2px solid #0a0a0f">${n}</div>`,
            className: 'tt-cluster',
            iconSize: [36, 36]
          });
        }
      }).addTo(map);
    } else {
      markerCluster = incidentMarkers;
    }

    return api('traffic/config').then(cfg => {
      enabled = cfg.enabled;
      if (!enabled) {
        if (onStatusChange) onStatusChange('disabled');
        return false;
      }

      flowLayer = L.tileLayer(cfg.flowTileUrl || '', {
        minZoom: 10,
        maxZoom: 20,
        opacity: 0.88,
        zIndex: 450,
        pane: 'overlayPane',
        attribution: '&copy; <a href="https://www.tomtom.com">TomTom</a> Traffic'
      });

      flowLayer.addTo(map);

      map.on('moveend', scheduleLoad);
      map.on('zoomend', scheduleLoad);

      refreshTimer = setInterval(() => {
        clientCache.clear();
        loadTraffic(true);
      }, REFRESH_MS);

      loadTraffic(true);
      return true;
    }).catch(() => {
      if (onStatusChange) onStatusChange('disabled');
      return false;
    });
  }

  function destroy() {
    clearTimeout(debounceTimer);
    clearInterval(refreshTimer);
    if (map) {
      map.off('moveend', scheduleLoad);
      map.off('zoomend', scheduleLoad);
    }
    if (flowLayer && map) map.removeLayer(flowLayer);
    if (markerCluster && map) map.removeLayer(markerCluster);
    if (incidentLines && map) map.removeLayer(incidentLines);
    clientCache.clear();
    lastState = null;
  }

  return { init, destroy, loadTraffic, getZoomTier };
})();
