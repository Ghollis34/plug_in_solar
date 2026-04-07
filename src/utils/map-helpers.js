import maplibregl from 'maplibre-gl';

const SATELLITE_SOURCE_ID = 'esri-satellite';
const SATELLITE_LAYER_ID = 'esri-satellite-layer';

const ESRI_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = '© Esri, Maxar, Earthstar Geographics';

/**
 * Add 3D buildings layer to the map
 */
export function add3DBuildings(map) {
  const layers = map.getStyle().layers;
  let labelLayerId;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
      labelLayerId = layers[i].id;
      break;
    }
  }

  if (map.getLayer('3d-buildings')) return;

  map.addLayer({
    id: '3d-buildings',
    source: 'openmaptiles',
    'source-layer': 'building',
    type: 'fill-extrusion',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': [
        'interpolate', ['linear'], ['get', 'render_height'],
        0, '#2D3748',
        10, '#3D4A5C',
        20, '#4A5568',
        40, '#5A6A80',
      ],
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.75,
    },
  }, labelLayerId);
}

/**
 * Add satellite imagery source and layer (hidden by default)
 */
export function addSatelliteSource(map) {
  if (map.getSource(SATELLITE_SOURCE_ID)) return;

  map.addSource(SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: [ESRI_TILE_URL],
    tileSize: 256,
    attribution: ESRI_ATTRIBUTION,
    maxzoom: 19,
  });

  // Insert satellite BELOW all vector layers so buildings/labels still show on top
  const firstLayerId = map.getStyle().layers[0]?.id;
  map.addLayer({
    id: SATELLITE_LAYER_ID,
    type: 'raster',
    source: SATELLITE_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 1 },
  }, firstLayerId);
}

/**
 * Toggle satellite layer visibility
 * Returns true if satellite is now visible
 */
export function toggleSatellite(map) {
  if (!map.getLayer(SATELLITE_LAYER_ID)) return false;

  const current = map.getLayoutProperty(SATELLITE_LAYER_ID, 'visibility');
  const isVisible = current === 'visible';
  
  map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', isVisible ? 'none' : 'visible');

  // When satellite is on, make 3D buildings semi-transparent so they don't fully obscure
  if (map.getLayer('3d-buildings')) {
    map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', isVisible ? 0.75 : 0.4);
  }

  return !isVisible;
}

/**
 * Check if satellite is currently active
 */
export function isSatelliteActive(map) {
  if (!map.getLayer(SATELLITE_LAYER_ID)) return false;
  return map.getLayoutProperty(SATELLITE_LAYER_ID, 'visibility') === 'visible';
}

/**
 * Add the satellite toggle button to the map
 * Must be called after map 'load' event
 */
export function addSatelliteToggle(map, containerId) {
  addSatelliteSource(map);

  const container = document.getElementById(containerId) || map.getContainer();
  
  // Create toggle button
  const btn = document.createElement('button');
  btn.id = 'btn-satellite-toggle';
  btn.className = 'satellite-toggle-btn';
  btn.innerHTML = '🛰️ Satellite';
  btn.title = 'Toggle satellite imagery';
  
  btn.addEventListener('click', () => {
    const nowActive = toggleSatellite(map);
    btn.classList.toggle('active', nowActive);
    btn.innerHTML = nowActive ? '🗺️ Street' : '🛰️ Satellite';
  });

  container.appendChild(btn);
}

/**
 * Draw obstacles on the map (fences, trees, sheds)
 */
export function drawObstacles(map, obstacles = []) {
  // Remove existing obstacle layers
  ['obstacle-fences', 'obstacle-trees', 'obstacle-sheds', 'obstacle-fence-labels'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource('obstacles-source')) map.removeSource('obstacles-source');

  if (obstacles.length === 0) return;

  const fenceFeatures = [];
  const treeFeatures = [];
  const shedFeatures = [];

  obstacles.forEach((obs, i) => {
    if (obs.type === 'fence' && obs.points?.length >= 2) {
      fenceFeatures.push({
        type: 'Feature',
        properties: { id: i, height: obs.heightM, label: `Fence ${obs.heightM}m` },
        geometry: {
          type: 'LineString',
          coordinates: obs.points.map(p => [p.lng, p.lat]),
        }
      });
    } else if (obs.type === 'tree') {
      treeFeatures.push({
        type: 'Feature',
        properties: { id: i, height: obs.heightM, radius: obs.canopyRadiusM },
        geometry: { type: 'Point', coordinates: [obs.lng, obs.lat] }
      });
    } else if (obs.type === 'shed') {
      shedFeatures.push({
        type: 'Feature',
        properties: { id: i, height: obs.heightM },
        geometry: { type: 'Point', coordinates: [obs.lng, obs.lat] }
      });
    }
  });

  // Add combined source
  const allFeatures = [...fenceFeatures, ...treeFeatures, ...shedFeatures];
  if (allFeatures.length === 0) return;

  map.addSource('obstacles-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: allFeatures }
  });

  // Fence lines
  if (fenceFeatures.length > 0) {
    map.addSource('fence-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: fenceFeatures }
    });
    map.addLayer({
      id: 'obstacle-fences',
      type: 'line',
      source: 'fence-source',
      paint: {
        'line-color': '#F97316',
        'line-width': 4,
        'line-dasharray': [2, 1],
        'line-opacity': 0.9,
      }
    });
  }

  // Tree circles
  if (treeFeatures.length > 0) {
    map.addSource('tree-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: treeFeatures }
    });
    map.addLayer({
      id: 'obstacle-trees',
      type: 'circle',
      source: 'tree-source',
      paint: {
        'circle-color': 'rgba(34, 197, 94, 0.4)',
        'circle-radius': 12,
        'circle-stroke-color': '#22C55E',
        'circle-stroke-width': 2,
      }
    });
  }

  // Shed markers
  if (shedFeatures.length > 0) {
    map.addSource('shed-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: shedFeatures }
    });
    map.addLayer({
      id: 'obstacle-sheds',
      type: 'circle',
      source: 'shed-source',
      paint: {
        'circle-color': 'rgba(148, 163, 184, 0.4)',
        'circle-radius': 10,
        'circle-stroke-color': '#94A3B8',
        'circle-stroke-width': 2,
      }
    });
  }
}

/**
 * Convert lat/lng displacement to meters (approximate, good enough for UK)
 */
export function latLngToMeters(lat1, lng1, lat2, lng2) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat1 * Math.PI / 180);
  return {
    dx: (lng2 - lng1) * mPerDegLng,
    dy: (lat2 - lat1) * mPerDegLat,
  };
}

/**
 * Convert meters offset from a point back to lat/lng
 */
export function metersToLatLng(lat, lng, dx, dy) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
  return {
    lat: lat + dy / mPerDegLat,
    lng: lng + dx / mPerDegLng,
  };
}
