/**
 * Maply — Leaflet preview map (nova ocorrência, reutilizável)
 */
const MapPreview = (() => {
  const DEFAULT_CENTER = [-27.5954, -48.5480];
  const DEFAULT_ZOOM = 13;

  let map = null;
  let marker = null;
  let baseLayer = null;

  function getTileConfig() {
    if (typeof MapTiles !== 'undefined') return MapTiles.getLayerOptions();
    return {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20
    };
  }

  function applyBaseLayer() {
    if (!map) return;
    const cfg = getTileConfig();
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      subdomains: cfg.subdomains || 'abcd',
      maxZoom: cfg.maxZoom || 20
    }).addTo(map);
  }

  function init(containerId, options = {}) {
    const el = document.getElementById(containerId);
    if (!el || typeof L === 'undefined') return null;

    const center = options.center || DEFAULT_CENTER;
    const zoom = options.zoom || DEFAULT_ZOOM;

    map = L.map(el, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: true
    }).setView(center, zoom);

    applyBaseLayer();

    marker = L.circleMarker(center, {
      radius: 10,
      color: '#0a0a0f',
      fillColor: '#d4ff00',
      fillOpacity: 0.9,
      weight: 2
    }).addTo(map);

    if (typeof Theme !== 'undefined') {
      Theme.onChange(() => applyBaseLayer());
    }

    setTimeout(() => map.invalidateSize(), 100);
    return map;
  }

  function setPosition(lat, lon, options = {}) {
    if (!map || lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const coords = [lat, lon];
    if (marker) {
      marker.setLatLng(coords);
    } else {
      marker = L.circleMarker(coords, {
        radius: 10,
        color: '#0a0a0f',
        fillColor: '#d4ff00',
        fillOpacity: 0.9,
        weight: 2
      }).addTo(map);
    }

    const zoom = options.zoom != null ? options.zoom : Math.max(map.getZoom(), 15);
    if (options.fly) {
      map.flyTo(coords, zoom, { duration: 0.6 });
    } else {
      map.setView(coords, zoom);
    }
  }

  function clearMarker() {
    if (marker && map) {
      map.removeLayer(marker);
      marker = null;
    }
    if (map) map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }

  function invalidate() {
    if (map) map.invalidateSize();
  }

  return { init, setPosition, clearMarker, invalidate, applyBaseLayer };
})();
