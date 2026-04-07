import maplibregl from 'maplibre-gl';
import { getRectangleRing, latLngToMeters } from './geometry.js';

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const BUILDING_LAYER_ID = '3d-buildings';
const SATELLITE_SOURCE_ID = 'esri-satellite';
const SATELLITE_LAYER_ID = 'esri-satellite-layer';
const SATELLITE_TOGGLE_CLASS = 'satellite-toggle-btn';
const BUILDING_PREVIEW_SOURCE_ID = 'building-preview-source';
const BUILDING_PREVIEW_FILL_ID = 'building-preview-fill';
const BUILDING_PREVIEW_OUTLINE_ID = 'building-preview-outline';
const HEATMAP_SOURCE_ID = 'sun-suitability-source';
const HEATMAP_LAYER_ID = 'sun-suitability-layer';
const SHADOW_SOURCE_ID = 'dynamic-shadow-source';
const SHADOW_FILL_ID = 'dynamic-shadow-fill';
const SHADOW_OUTLINE_ID = 'dynamic-shadow-outline';

const ESRI_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Powered by Esri | Sources: Esri, Vantor, Earthstar Geographics, GIS User Community';

export function createStepMap({
  container,
  center,
  zoom = 17,
  pitch = 0,
  bearing = 0,
  maxBounds,
  style = DEFAULT_STYLE,
  satelliteToggle = true,
  satelliteDefault = false,
  onLoad,
}) {
  const map = new maplibregl.Map({
    container,
    style,
    center,
    zoom,
    pitch,
    bearing,
    maxBounds,
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  map.on('load', () => {
    add3DBuildings(map);
    addSatelliteSource(map);

    if (satelliteToggle) {
      addSatelliteToggle(map);
      if (satelliteDefault) {
        setSatelliteActive(map, true);
      }
    }

    onLoad?.(map);
  });

  return map;
}

export function add3DBuildings(map) {
  if (map.getLayer(BUILDING_LAYER_ID)) return;

  const layers = map.getStyle().layers || [];
  let labelLayerId;

  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
      labelLayerId = layers[i].id;
      break;
    }
  }

  map.addLayer({
    id: BUILDING_LAYER_ID,
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

export function addSatelliteSource(map) {
  if (map.getSource(SATELLITE_SOURCE_ID)) return;

  map.addSource(SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: [ESRI_TILE_URL],
    tileSize: 256,
    attribution: ESRI_ATTRIBUTION,
    maxzoom: 19,
  });

  const insertBeforeId = getSatelliteInsertBeforeId(map);
  map.addLayer({
    id: SATELLITE_LAYER_ID,
    type: 'raster',
    source: SATELLITE_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 1 },
  }, insertBeforeId);
}

export function addSatelliteToggle(map) {
  const container = map.getContainer();
  const existing = container.querySelector(`.${SATELLITE_TOGGLE_CLASS}`);
  if (existing) return existing;

  const btn = document.createElement('button');
  btn.className = SATELLITE_TOGGLE_CLASS;
  btn.title = 'Toggle satellite imagery';
  syncSatelliteToggleLabel(btn, isSatelliteActive(map));

  btn.addEventListener('click', () => {
    const nowActive = toggleSatellite(map);
    syncSatelliteToggleLabel(btn, nowActive);
  });

  container.appendChild(btn);
  return btn;
}

function syncSatelliteToggleLabel(btn, active) {
  btn.classList.toggle('active', active);
  btn.innerHTML = active ? '🗺️ Street' : '🛰️ Satellite';
}

export function toggleSatellite(map) {
  const nextState = !isSatelliteActive(map);
  setSatelliteActive(map, nextState);
  return nextState;
}

export function setSatelliteActive(map, active) {
  if (!map.getLayer(SATELLITE_LAYER_ID)) return false;

  map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', active ? 'visible' : 'none');

  if (map.getLayer(BUILDING_LAYER_ID)) {
    map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-opacity', active ? 0.18 : 0.75);
  }

  const toggle = map.getContainer().querySelector(`.${SATELLITE_TOGGLE_CLASS}`);
  if (toggle) {
    syncSatelliteToggleLabel(toggle, active);
  }

  return active;
}

export function isSatelliteActive(map) {
  if (!map.getLayer(SATELLITE_LAYER_ID)) return false;
  return map.getLayoutProperty(SATELLITE_LAYER_ID, 'visibility') === 'visible';
}

export function drawBuildingFootprintPreview(map, building) {
  clearBuildingFootprintPreview(map);

  if (!Number.isFinite(building?.lat) || !Number.isFinite(building?.lng) || building.frontDoorFacing == null) {
    return;
  }

  const ring = getRectangleRing(
    building.lat,
    building.lng,
    building.widthM || 5,
    building.depthM || 9,
    building.frontDoorFacing
  );

  map.addSource(BUILDING_PREVIEW_SOURCE_ID, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [ring.map(({ lng, lat }) => [lng, lat])],
          },
        },
      ],
    },
  });

  map.addLayer({
    id: BUILDING_PREVIEW_FILL_ID,
    type: 'fill',
    source: BUILDING_PREVIEW_SOURCE_ID,
    paint: {
      'fill-color': 'rgba(59, 130, 246, 0.16)',
    },
  });

  map.addLayer({
    id: BUILDING_PREVIEW_OUTLINE_ID,
    type: 'line',
    source: BUILDING_PREVIEW_SOURCE_ID,
    paint: {
      'line-color': '#60A5FA',
      'line-width': 2,
      'line-opacity': 0.95,
      'line-dasharray': [2, 1],
    },
  });
}

export function clearBuildingFootprintPreview(map) {
  removeLayerIfExists(map, BUILDING_PREVIEW_FILL_ID);
  removeLayerIfExists(map, BUILDING_PREVIEW_OUTLINE_ID);
  removeSourceIfExists(map, BUILDING_PREVIEW_SOURCE_ID);
}

export function drawObstacles(map, obstacles = []) {
  const sourceDefs = [
    ['obstacle-fences', 'obstacle-fences-source'],
    ['obstacle-trees', 'obstacle-trees-source'],
    ['obstacle-sheds', 'obstacle-sheds-source'],
    ['obstacle-shed-outline', 'obstacle-sheds-source'],
  ];

  sourceDefs.forEach(([layerId]) => removeLayerIfExists(map, layerId));
  ['obstacle-fences-source', 'obstacle-trees-source', 'obstacle-sheds-source'].forEach(id => removeSourceIfExists(map, id));

  if (!obstacles.length) return;

  const fenceFeatures = [];
  const treeFeatures = [];
  const shedFeatures = [];

  obstacles.forEach((obs) => {
    if (obs.type === 'fence' && obs.points?.length >= 2) {
      fenceFeatures.push({
        type: 'Feature',
        properties: { id: obs.id, heightM: obs.heightM, label: `Fence ${obs.heightM}m` },
        geometry: {
          type: 'LineString',
          coordinates: obs.points.map((point) => [point.lng, point.lat]),
        },
      });
    } else if (obs.type === 'tree' && Number.isFinite(obs.lat) && Number.isFinite(obs.lng)) {
      treeFeatures.push({
        type: 'Feature',
        properties: { id: obs.id, heightM: obs.heightM, canopyRadiusM: obs.canopyRadiusM },
        geometry: {
          type: 'Point',
          coordinates: [obs.lng, obs.lat],
        },
      });
    } else if (obs.type === 'shed' && Number.isFinite(obs.lat) && Number.isFinite(obs.lng)) {
      const widthM = obs.widthM || 3;
      const depthM = obs.depthM || 2;
      const rotationDeg = obs.rotationDeg || 0;
      const ring = getRectangleRing(obs.lat, obs.lng, widthM, depthM, rotationDeg);

      shedFeatures.push({
        type: 'Feature',
        properties: { id: obs.id, heightM: obs.heightM },
        geometry: {
          type: 'Polygon',
          coordinates: [ring.map(({ lng, lat }) => [lng, lat])],
        },
      });
    }
  });

  if (fenceFeatures.length) {
    map.addSource('obstacle-fences-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: fenceFeatures },
    });

    map.addLayer({
      id: 'obstacle-fences',
      type: 'line',
      source: 'obstacle-fences-source',
      paint: {
        'line-color': '#F97316',
        'line-width': 4,
        'line-dasharray': [2, 1],
        'line-opacity': 0.9,
      },
    });
  }

  if (treeFeatures.length) {
    map.addSource('obstacle-trees-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: treeFeatures },
    });

    map.addLayer({
      id: 'obstacle-trees',
      type: 'circle',
      source: 'obstacle-trees-source',
      paint: {
        'circle-color': 'rgba(34, 197, 94, 0.28)',
        'circle-radius': 12,
        'circle-stroke-color': '#22C55E',
        'circle-stroke-width': 2,
      },
    });
  }

  if (shedFeatures.length) {
    map.addSource('obstacle-sheds-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: shedFeatures },
    });

    map.addLayer({
      id: 'obstacle-sheds',
      type: 'fill',
      source: 'obstacle-sheds-source',
      paint: {
        'fill-color': 'rgba(148, 163, 184, 0.28)',
      },
    });

    map.addLayer({
      id: 'obstacle-shed-outline',
      type: 'line',
      source: 'obstacle-sheds-source',
      paint: {
        'line-color': '#CBD5E1',
        'line-width': 2,
      },
    });
  }
}

export function drawSuitabilityHeatmap(map, featureCollection) {
  removeLayerIfExists(map, HEATMAP_LAYER_ID);
  removeLayerIfExists(map, `${HEATMAP_LAYER_ID}-points`);
  removeSourceIfExists(map, HEATMAP_SOURCE_ID);

  if (!featureCollection?.features?.length) return;

  map.addSource(HEATMAP_SOURCE_ID, {
    type: 'geojson',
    data: featureCollection,
  });

  map.addLayer({
    id: HEATMAP_LAYER_ID,
    type: 'heatmap',
    source: HEATMAP_SOURCE_ID,
    paint: {
      'heatmap-weight': [
        'interpolate',
        ['linear'],
        ['get', 'score'],
        0, 0.1,
        1, 1,
      ],
      'heatmap-intensity': 1.1,
      'heatmap-radius': 26,
      'heatmap-opacity': 0.52,
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0, 'rgba(0,0,0,0)',
        0.15, 'rgba(220, 38, 38, 0.45)',
        0.35, 'rgba(249, 115, 22, 0.55)',
        0.55, 'rgba(250, 204, 21, 0.62)',
        0.75, 'rgba(132, 204, 22, 0.7)',
        1, 'rgba(22, 163, 74, 0.78)',
      ],
    },
  }, BUILDING_LAYER_ID);

  map.addLayer({
    id: `${HEATMAP_LAYER_ID}-points`,
    type: 'circle',
    source: HEATMAP_SOURCE_ID,
    paint: {
      'circle-radius': 4,
      'circle-opacity': 0.16,
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'score'],
        0, '#DC2626',
        0.35, '#F97316',
        0.6, '#FACC15',
        0.8, '#84CC16',
        1, '#16A34A',
      ],
    },
  }, BUILDING_LAYER_ID);
}

export function clearSuitabilityHeatmap(map) {
  removeLayerIfExists(map, HEATMAP_LAYER_ID);
  removeLayerIfExists(map, `${HEATMAP_LAYER_ID}-points`);
  removeSourceIfExists(map, HEATMAP_SOURCE_ID);
}

export function drawDynamicShadows(map, featureCollection) {
  removeLayerIfExists(map, SHADOW_FILL_ID);
  removeLayerIfExists(map, SHADOW_OUTLINE_ID);
  removeSourceIfExists(map, SHADOW_SOURCE_ID);

  if (!featureCollection?.features?.length) return;

  map.addSource(SHADOW_SOURCE_ID, {
    type: 'geojson',
    data: featureCollection,
  });

  map.addLayer({
    id: SHADOW_FILL_ID,
    type: 'fill',
    source: SHADOW_SOURCE_ID,
    paint: {
      'fill-color': 'rgba(15, 23, 42, 0.42)',
    },
  });

  map.addLayer({
    id: SHADOW_OUTLINE_ID,
    type: 'line',
    source: SHADOW_SOURCE_ID,
    paint: {
      'line-color': 'rgba(15, 23, 42, 0.28)',
      'line-width': 1.2,
    },
  });
}

export function captureNearbyBuildings(map, center, options = {}) {
  const radiusM = options.radiusM ?? 100;
  const excludeRadiusM = options.excludeRadiusM ?? 12;

  let features = [];
  try {
    features = map.queryRenderedFeatures(undefined, { layers: [BUILDING_LAYER_ID] }) || [];
  } catch (error) {
    return [];
  }

  const seen = new Set();
  const buildings = [];

  features.forEach((feature, index) => {
    const polygons = getFeaturePolygons(feature.geometry);
    polygons.forEach((ring) => {
      const outerRing = ring?.[0];
      if (!outerRing?.length) return;

      const centroid = getRingCentroid(outerRing);
      const { dx, dy } = latLngToMeters(center.lat, center.lng, centroid.lat, centroid.lng);
      const distanceM = Math.hypot(dx, dy);
      if (distanceM > radiusM || distanceM < excludeRadiusM) return;

      const height = parseFloat(feature.properties?.render_height || feature.properties?.height || 8);
      const dedupeKey = `${centroid.lat.toFixed(6)}:${centroid.lng.toFixed(6)}:${Math.round(height)}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      buildings.push({
        id: `nearby-building-${index}-${buildings.length}`,
        kind: 'neighbor',
        lat: centroid.lat,
        lng: centroid.lng,
        height: Number.isFinite(height) ? height : 8,
        footprint: outerRing.map(([lng, lat]) => ({ lat, lng })),
      });
    });
  });

  return buildings;
}

function removeLayerIfExists(map, layerId) {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
}

function removeSourceIfExists(map, sourceId) {
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

function getSatelliteInsertBeforeId(map) {
  if (map.getLayer(BUILDING_LAYER_ID)) {
    return BUILDING_LAYER_ID;
  }

  const layers = map.getStyle().layers || [];
  const firstSymbol = layers.find((layer) => layer.type === 'symbol');
  return firstSymbol?.id;
}

function getFeaturePolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function getRingCentroid(ring) {
  let lng = 0;
  let lat = 0;

  ring.forEach(([ringLng, ringLat]) => {
    lng += ringLng;
    lat += ringLat;
  });

  return {
    lng: lng / ring.length,
    lat: lat / ring.length,
  };
}
