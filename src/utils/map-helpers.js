import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { distancePointToSegment, getRectangleRing, latLngToMeters, metersToLatLng, pointInPolygon } from './geometry.js';

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const BUILDING_LAYER_ID = '3d-buildings';
const DEFAULT_INTERACTIVE_MAX_ZOOM = 22;
const SATELLITE_NATIVE_MAX_ZOOM = 19;
const SATELLITE_ACTIVE_CONTRAST = 0.08;
const SATELLITE_ACTIVE_SATURATION = 0.06;
const SATELLITE_SOURCE_ID = 'esri-satellite';
const SATELLITE_LAYER_ID = 'esri-satellite-layer';
const SATELLITE_TOGGLE_CLASS = 'satellite-toggle-btn';
const BUILDING_PREVIEW_SOURCE_ID = 'building-preview-source';
const BUILDING_PREVIEW_FILL_ID = 'building-preview-fill';
const BUILDING_PREVIEW_OUTLINE_ID = 'building-preview-outline';
const HEATMAP_SOURCE_ID = 'sun-suitability-source';
const HEATMAP_LAYER_ID = 'sun-suitability-layer';
const HEATMAP_OUTLINE_ID = 'sun-suitability-outline';
const SHADOW_SOURCE_ID = 'dynamic-shadow-source';
const SHADOW_FILL_ID = 'dynamic-shadow-fill';
const SHADOW_OUTLINE_ID = 'dynamic-shadow-outline';
const OBSTACLE_FENCE_SOURCE_ID = 'obstacle-fences-source';
const OBSTACLE_FENCE_FILL_ID = 'obstacle-fences';
const OBSTACLE_FENCE_OUTLINE_ID = 'obstacle-fence-outline';
const OBSTACLE_TREE_SOURCE_ID = 'obstacle-trees-source';
const OBSTACLE_TREE_LAYER_ID = 'obstacle-trees';
const OBSTACLE_SHED_SOURCE_ID = 'obstacle-sheds-source';
const OBSTACLE_SHED_FILL_ID = 'obstacle-sheds';
const OBSTACLE_SHED_OUTLINE_ID = 'obstacle-shed-outline';
const MAP_INTERACTION_HINT_CLASS = 'map-interaction-hint';
const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] };
const EARTH_CIRCUMFERENCE_M = 40075016.686;
const MAPLIBRE_TILE_SIZE_PX = 512;
const STANDARD_PANEL_WIDTH_M = 1.76;
const STANDARD_PANEL_HEIGHT_M = 1.13;
const PANEL_MARKER_MIN_WIDTH_PX = 6;
const PANEL_MARKER_MAX_WIDTH_PX = 44;
const PANEL_MARKER_COMPACT_MIN_WIDTH_PX = 5;
const PANEL_MARKER_COMPACT_MAX_WIDTH_PX = 36;

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
  interactionHint = true,
  interactionHintText,
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
    maxZoom: DEFAULT_INTERACTIVE_MAX_ZOOM,
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  enableMiddleButtonOrbit(map);

  map.on('load', () => {
    add3DBuildings(map);
    addSatelliteSource(map);

    if (satelliteToggle) {
      addSatelliteToggle(map);
      if (satelliteDefault) {
        setSatelliteActive(map, true);
      }
    }

    if (interactionHint) {
      addMapInteractionHint(map, interactionHintText);
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
    maxzoom: SATELLITE_NATIVE_MAX_ZOOM,
  });

  const insertBeforeId = getSatelliteInsertBeforeId(map);
  map.addLayer({
    id: SATELLITE_LAYER_ID,
    type: 'raster',
    source: SATELLITE_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'raster-opacity': 1,
      'raster-resampling': 'linear',
      'raster-contrast': 0,
      'raster-saturation': 0,
    },
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
  btn.textContent = active ? '🗺️ Street' : '🛰️ Satellite';
}

export function toggleSatellite(map) {
  const nextState = !isSatelliteActive(map);
  setSatelliteActive(map, nextState);
  return nextState;
}

export function setSatelliteActive(map, active) {
  if (!map.getLayer(SATELLITE_LAYER_ID)) return false;

  map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', active ? 'visible' : 'none');
  if (typeof map.setMaxZoom === 'function') {
    map.setMaxZoom(DEFAULT_INTERACTIVE_MAX_ZOOM);
  }

  if (map.getLayer(SATELLITE_LAYER_ID)) {
    map.setPaintProperty(SATELLITE_LAYER_ID, 'raster-resampling', active ? 'nearest' : 'linear');
    map.setPaintProperty(SATELLITE_LAYER_ID, 'raster-contrast', active ? SATELLITE_ACTIVE_CONTRAST : 0);
    map.setPaintProperty(SATELLITE_LAYER_ID, 'raster-saturation', active ? SATELLITE_ACTIVE_SATURATION : 0);
  }

  if (map.getLayer(BUILDING_LAYER_ID)) {
    map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-opacity', active ? 0.18 : 0.75);
  }

  // Boost heatmap contrast over satellite imagery
  if (map.getLayer(HEATMAP_LAYER_ID)) {
    map.setPaintProperty(HEATMAP_LAYER_ID, 'fill-opacity', active ? 0.54 : 0.38);
  }

  if (map.getLayer(HEATMAP_OUTLINE_ID)) {
    map.setPaintProperty(HEATMAP_OUTLINE_ID, 'line-opacity', active ? 0.2 : 0.12);
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

export function hasUsableMapStyle(map) {
  if (!map || typeof map.getStyle !== 'function') {
    return false;
  }

  try {
    const style = map.getStyle();
    return Array.isArray(style?.layers) && style.layers.length > 0;
  } catch (error) {
    return false;
  }
}

export function drawBuildingFootprintPreview(map, building) {
  if (!hasUsableMapStyle(map)) return false;

  const data = getBuildingPreviewData(building);
  ensureBuildingPreviewLayers(map, data);
  setGeoJsonSourceData(map, BUILDING_PREVIEW_SOURCE_ID, data);
  return true;
}

export function clearBuildingFootprintPreview(map) {
  if (!hasUsableMapStyle(map)) return false;

  if (map.getSource(BUILDING_PREVIEW_SOURCE_ID)) {
    setGeoJsonSourceData(map, BUILDING_PREVIEW_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
  }

  return true;
}

export function drawObstacles(map, obstacles = []) {
  if (!hasUsableMapStyle(map)) return false;

  const normalizedObstacles = normalizeObstacles(obstacles);
  const {
    fenceData,
    treeData,
    shedData,
  } = buildObstacleFeatureCollections(normalizedObstacles);

  ensureObstacleLayers(map, {
    fenceData,
    treeData,
    shedData,
  });

  setGeoJsonSourceData(map, OBSTACLE_FENCE_SOURCE_ID, fenceData);
  setGeoJsonSourceData(map, OBSTACLE_TREE_SOURCE_ID, treeData);
  setGeoJsonSourceData(map, OBSTACLE_SHED_SOURCE_ID, shedData);

  forceMapRepaint(map);
  return true;
}

export function normalizeObstacles(obstacles = []) {
  if (!Array.isArray(obstacles)) return [];

  return obstacles
    .map((obstacle) => normalizeObstacle(obstacle))
    .filter(Boolean);
}

function normalizeObstacle(obstacle) {
  if (!obstacle || typeof obstacle !== 'object') return null;

  if (obstacle.type === 'fence') {
    const points = Array.isArray(obstacle.points)
      ? obstacle.points
        .map((point) => ({
          lat: toFiniteNumber(point?.lat, NaN),
          lng: toFiniteNumber(point?.lng, NaN),
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      : [];

    if (points.length < 2) return null;

    return {
      ...obstacle,
      points,
      heightM: toFiniteNumber(obstacle.heightM, 1.8),
    };
  }

  if (obstacle.type === 'tree') {
    const lat = toFiniteNumber(obstacle.lat, NaN);
    const lng = toFiniteNumber(obstacle.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      ...obstacle,
      lat,
      lng,
      heightM: toFiniteNumber(obstacle.heightM, 5),
      canopyRadiusM: toFiniteNumber(obstacle.canopyRadiusM, 3),
    };
  }

  if (obstacle.type === 'shed') {
    const lat = toFiniteNumber(obstacle.lat, NaN);
    const lng = toFiniteNumber(obstacle.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      ...obstacle,
      lat,
      lng,
      heightM: toFiniteNumber(obstacle.heightM, 2.5),
      widthM: toFiniteNumber(obstacle.widthM, 3),
      depthM: toFiniteNumber(obstacle.depthM, 2),
      rotationDeg: toFiniteNumber(obstacle.rotationDeg, 0),
    };
  }

  return null;
}

function getBufferedFenceRing(startPoint, endPoint, widthM = 0.2) {
  const segment = latLngToMeters(startPoint.lat, startPoint.lng, endPoint.lat, endPoint.lng);
  const length = Math.hypot(segment.dx, segment.dy);

  if (!length) {
    return getRectangleRing(startPoint.lat, startPoint.lng, widthM, widthM, 0);
  }

  const normalX = (-segment.dy / length) * (widthM / 2);
  const normalY = (segment.dx / length) * (widthM / 2);

  const corners = [
    metersToLatLng(startPoint.lat, startPoint.lng, normalX, normalY),
    metersToLatLng(startPoint.lat, startPoint.lng, segment.dx + normalX, segment.dy + normalY),
    metersToLatLng(startPoint.lat, startPoint.lng, segment.dx - normalX, segment.dy - normalY),
    metersToLatLng(startPoint.lat, startPoint.lng, -normalX, -normalY),
  ];

  return [...corners, corners[0]];
}

function forceMapRepaint(map) {
  if (!map || typeof map.triggerRepaint !== 'function') return;

  map.triggerRepaint();

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      map.triggerRepaint();
    });
  }
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function drawSuitabilityHeatmap(map, featureCollection) {
  if (!hasUsableMapStyle(map)) return false;

  const data = featureCollection?.features?.length
    ? featureCollection
    : EMPTY_FEATURE_COLLECTION;

  ensureSuitabilityHeatmapLayers(map, data);
  setGeoJsonSourceData(map, HEATMAP_SOURCE_ID, data);
  return true;
}

export function clearSuitabilityHeatmap(map) {
  if (!hasUsableMapStyle(map)) return false;

  if (map.getSource(HEATMAP_SOURCE_ID)) {
    setGeoJsonSourceData(map, HEATMAP_SOURCE_ID, EMPTY_FEATURE_COLLECTION);
  }

  return true;
}

export function drawDynamicShadows(map, featureCollection) {
  if (!hasUsableMapStyle(map)) return false;

  const data = featureCollection?.type === 'FeatureCollection'
    ? featureCollection
    : EMPTY_FEATURE_COLLECTION;

  ensureDynamicShadowLayers(map, data);

  const source = map.getSource(SHADOW_SOURCE_ID);
  source?.setData(data);
  return true;
}

function ensureDynamicShadowLayers(map, initialData = EMPTY_FEATURE_COLLECTION) {
  ensureGeoJsonSource(map, SHADOW_SOURCE_ID, initialData);

  if (!map.getLayer(SHADOW_FILL_ID)) {
    map.addLayer({
      id: SHADOW_FILL_ID,
      type: 'fill',
      source: SHADOW_SOURCE_ID,
      paint: {
        'fill-color': 'rgba(15, 23, 42, 0.42)',
      },
    });
  }

  if (!map.getLayer(SHADOW_OUTLINE_ID)) {
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
}

export function createPanelMarkerElement(space, options = {}) {
  const compact = options.compact === true;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `panel-marker${compact ? ' panel-marker-compact' : ''}`;

  const halo = document.createElement('span');
  halo.className = 'panel-marker-halo';

  const surface = document.createElement('span');
  surface.className = 'panel-marker-surface';

  const card = document.createElement('span');
  card.className = 'panel-marker-card';

  const grid = document.createElement('span');
  grid.className = 'panel-marker-grid';

  const cells = document.createElement('span');
  cells.className = 'panel-marker-cells';

  card.append(grid, cells);
  el.append(halo, surface, card);

  if (typeof options.onClick === 'function') {
    el.addEventListener('click', options.onClick);
  }

  updatePanelMarkerElement(el, space, {
    selected: options.selected === true,
    zoom: options.zoom,
    lat: options.lat,
  });
  return el;
}

export function updatePanelMarkerElement(element, space, options = {}) {
  const rotation = options.rotation ?? space.displayRotation ?? space.orientation ?? 180;
  const selected = options.selected === true;
  const compact = element.classList.contains('panel-marker-compact');
  const visualSize = getPanelMarkerVisualSize({
    zoom: options.zoom,
    lat: options.lat ?? space.centerLat,
    compact,
  });

  element.classList.toggle('selected', selected);
  element.style.setProperty('--panel-rotation', `${rotation}deg`);
  element.style.setProperty('--panel-card-width', `${visualSize.widthPx}px`);
  element.style.setProperty('--panel-card-height', `${visualSize.heightPx}px`);
  element.style.setProperty('--panel-surface-width', `${Math.max(visualSize.widthPx + 8, 14)}px`);
  element.setAttribute('aria-label', `${space.name || 'Panel location'} marker`);
  element.dataset.spaceType = space.type || 'ground';
  element.dataset.surfaceAligned = space.surfaceAligned ? 'true' : 'false';
  element.dataset.markerScale = 'true-size';

}

export function getPanelMarkerVisualSize(options = {}) {
  const compact = options.compact === true;
  const minWidth = compact ? PANEL_MARKER_COMPACT_MIN_WIDTH_PX : PANEL_MARKER_MIN_WIDTH_PX;
  const maxWidth = compact ? PANEL_MARKER_COMPACT_MAX_WIDTH_PX : PANEL_MARKER_MAX_WIDTH_PX;
  const zoom = Number.isFinite(options.zoom) ? clamp(options.zoom, 0, DEFAULT_INTERACTIVE_MAX_ZOOM) : 18.5;
  const lat = Number.isFinite(options.lat) ? clamp(options.lat, -85, 85) : 52;
  const widthM = Number.isFinite(options.widthM) ? options.widthM : STANDARD_PANEL_WIDTH_M;
  const heightM = Number.isFinite(options.heightM) ? options.heightM : STANDARD_PANEL_HEIGHT_M;
  const latitudeScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.087);
  const metersPerPixel = (latitudeScale * EARTH_CIRCUMFERENCE_M) / (MAPLIBRE_TILE_SIZE_PX * (2 ** zoom));

  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return {
      widthPx: minWidth,
      heightPx: Math.max(4, roundToTenth(minWidth * (heightM / widthM))),
    };
  }

  const widthPx = clamp(widthM / metersPerPixel, minWidth, maxWidth);
  const heightPx = clamp(heightM / metersPerPixel, Math.max(4, minWidth * (heightM / widthM)), maxWidth * (heightM / widthM));

  return {
    widthPx: roundToTenth(widthPx),
    heightPx: roundToTenth(heightPx),
  };
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

export function captureNearbyBuildings(map, center, options = {}) {
  const radiusM = options.radiusM ?? 100;
  const excludeContainingCenter = options.excludeContainingCenter === true;
  const excludeFootprint = options.excludeFootprint ?? null;

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
      if (distanceM > radiusM) return;

      const footprintDistanceM = getDistanceFromCenterToRing(center, outerRing);
      if (excludeContainingCenter && footprintDistanceM === 0) return;
      if (excludeFootprint && areRingsLikelySameBuilding(excludeFootprint, outerRing)) return;

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

export function getShadeModelBuildings(map, existingBuildings = [], options = {}) {
  if (!map) return existingBuildings;

  const userBuilding = existingBuildings.find((building) => building.kind === 'user' || building.id === 'user-building') || null;
  const center = options.center
    || (userBuilding && Number.isFinite(userBuilding.lat) && Number.isFinite(userBuilding.lng)
      ? { lat: userBuilding.lat, lng: userBuilding.lng }
      : null);

  if (!center) return existingBuildings;

  const liveNearbyBuildings = captureNearbyBuildings(map, center, {
    radiusM: options.radiusM ?? 120,
    excludeContainingCenter: !userBuilding?.footprint?.length,
    excludeFootprint: userBuilding?.footprint?.length ? userBuilding.footprint.map(({ lat, lng }) => [lng, lat]) : null,
  });

  const merged = [];
  const seen = new Set();

  [...existingBuildings, ...liveNearbyBuildings].forEach((building) => {
    const key = createBuildingFingerprint(building);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(building);
  });

  return merged;
}

function getBuildingPreviewData(building) {
  const ring = getBuildingPreviewRing(building);
  if (!ring?.length) {
    return EMPTY_FEATURE_COLLECTION;
  }

  return {
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
  };
}

function buildObstacleFeatureCollections(normalizedObstacles = []) {
  const fenceFeatures = [];
  const treeFeatures = [];
  const shedFeatures = [];

  normalizedObstacles.forEach((obs) => {
    if (obs.type === 'fence' && obs.points?.length >= 2) {
      const ring = getBufferedFenceRing(obs.points[0], obs.points[1], 0.2);
      fenceFeatures.push({
        type: 'Feature',
        properties: { id: obs.id, heightM: obs.heightM, label: `Fence ${obs.heightM}m` },
        geometry: {
          type: 'Polygon',
          coordinates: [ring.map((point) => [point.lng, point.lat])],
        },
      });
      return;
    }

    if (obs.type === 'tree' && Number.isFinite(obs.lat) && Number.isFinite(obs.lng)) {
      treeFeatures.push({
        type: 'Feature',
        properties: { id: obs.id, heightM: obs.heightM, canopyRadiusM: obs.canopyRadiusM },
        geometry: {
          type: 'Point',
          coordinates: [obs.lng, obs.lat],
        },
      });
      return;
    }

    if (obs.type === 'shed' && Number.isFinite(obs.lat) && Number.isFinite(obs.lng)) {
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

  return {
    fenceData: { type: 'FeatureCollection', features: fenceFeatures },
    treeData: { type: 'FeatureCollection', features: treeFeatures },
    shedData: { type: 'FeatureCollection', features: shedFeatures },
  };
}

function ensureBuildingPreviewLayers(map, initialData = EMPTY_FEATURE_COLLECTION) {
  ensureGeoJsonSource(map, BUILDING_PREVIEW_SOURCE_ID, initialData);

  if (!map.getLayer(BUILDING_PREVIEW_FILL_ID)) {
    map.addLayer({
      id: BUILDING_PREVIEW_FILL_ID,
      type: 'fill',
      source: BUILDING_PREVIEW_SOURCE_ID,
      paint: {
        'fill-color': 'rgba(59, 130, 246, 0.16)',
      },
    });
  }

  if (!map.getLayer(BUILDING_PREVIEW_OUTLINE_ID)) {
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
}

function ensureObstacleLayers(map, initialData = {}) {
  ensureGeoJsonSource(map, OBSTACLE_FENCE_SOURCE_ID, initialData.fenceData || EMPTY_FEATURE_COLLECTION);
  ensureGeoJsonSource(map, OBSTACLE_TREE_SOURCE_ID, initialData.treeData || EMPTY_FEATURE_COLLECTION);
  ensureGeoJsonSource(map, OBSTACLE_SHED_SOURCE_ID, initialData.shedData || EMPTY_FEATURE_COLLECTION);

  if (!map.getLayer(OBSTACLE_FENCE_FILL_ID)) {
    map.addLayer({
      id: OBSTACLE_FENCE_FILL_ID,
      type: 'fill-extrusion',
      source: OBSTACLE_FENCE_SOURCE_ID,
      paint: {
        'fill-extrusion-color': '#F97316',
        'fill-extrusion-height': ['coalesce', ['get', 'heightM'], 1.8],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.72,
      },
    });
  }

  if (!map.getLayer(OBSTACLE_FENCE_OUTLINE_ID)) {
    map.addLayer({
      id: OBSTACLE_FENCE_OUTLINE_ID,
      type: 'line',
      source: OBSTACLE_FENCE_SOURCE_ID,
      paint: {
        'line-color': '#FDBA74',
        'line-width': 1.6,
        'line-opacity': 0.9,
      },
    });
  }

  if (!map.getLayer(OBSTACLE_TREE_LAYER_ID)) {
    map.addLayer({
      id: OBSTACLE_TREE_LAYER_ID,
      type: 'circle',
      source: OBSTACLE_TREE_SOURCE_ID,
      paint: {
        'circle-color': 'rgba(34, 197, 94, 0.32)',
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          16, ['+', 6, ['*', ['coalesce', ['get', 'canopyRadiusM'], 3], 1.4]],
          20, ['+', 14, ['*', ['coalesce', ['get', 'canopyRadiusM'], 3], 2.7]],
        ],
        'circle-stroke-color': '#22C55E',
        'circle-stroke-width': 2,
      },
    });
  }

  if (!map.getLayer(OBSTACLE_SHED_FILL_ID)) {
    map.addLayer({
      id: OBSTACLE_SHED_FILL_ID,
      type: 'fill-extrusion',
      source: OBSTACLE_SHED_SOURCE_ID,
      paint: {
        'fill-extrusion-color': '#94A3B8',
        'fill-extrusion-height': ['coalesce', ['get', 'heightM'], 2.5],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.62,
      },
    });
  }

  if (!map.getLayer(OBSTACLE_SHED_OUTLINE_ID)) {
    map.addLayer({
      id: OBSTACLE_SHED_OUTLINE_ID,
      type: 'line',
      source: OBSTACLE_SHED_SOURCE_ID,
      paint: {
        'line-color': '#CBD5E1',
        'line-width': 2,
      },
    });
  }
}

function ensureSuitabilityHeatmapLayers(map, initialData = EMPTY_FEATURE_COLLECTION) {
  ensureGeoJsonSource(map, HEATMAP_SOURCE_ID, initialData);
  const insertBeforeId = map.getLayer(BUILDING_LAYER_ID) ? BUILDING_LAYER_ID : undefined;

  if (!map.getLayer(HEATMAP_LAYER_ID)) {
    map.addLayer({
      id: HEATMAP_LAYER_ID,
      type: 'fill',
      source: HEATMAP_SOURCE_ID,
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'score'],
          0, 'rgba(220, 38, 38, 0.62)',
          0.28, 'rgba(249, 115, 22, 0.68)',
          0.5, 'rgba(250, 204, 21, 0.72)',
          0.72, 'rgba(132, 204, 22, 0.76)',
          1, 'rgba(22, 163, 74, 0.82)',
        ],
        'fill-opacity': isSatelliteActive(map) ? 0.58 : 0.42,
      },
    }, insertBeforeId);
  }

  if (!map.getLayer(HEATMAP_OUTLINE_ID)) {
    map.addLayer({
      id: HEATMAP_OUTLINE_ID,
      type: 'line',
      source: HEATMAP_SOURCE_ID,
      paint: {
        'line-color': [
          'interpolate',
          ['linear'],
          ['get', 'score'],
          0, 'rgba(220, 38, 38, 0.82)',
          0.28, 'rgba(249, 115, 22, 0.82)',
          0.5, 'rgba(250, 204, 21, 0.85)',
          0.72, 'rgba(132, 204, 22, 0.88)',
          1, 'rgba(22, 163, 74, 0.9)',
        ],
        'line-width': 0.35,
        'line-opacity': isSatelliteActive(map) ? 0.05 : 0.025,
      },
    }, insertBeforeId);
  }
}

function ensureGeoJsonSource(map, sourceId, initialData = EMPTY_FEATURE_COLLECTION) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: initialData,
    });
  }
}

function setGeoJsonSourceData(map, sourceId, data) {
  const source = map.getSource(sourceId);
  source?.setData(data);
}

export function captureBuildingAtLocation(map, center, options = {}) {
  const searchRadiusM = options.searchRadiusM ?? 24;

  let features = [];
  try {
    features = map.queryRenderedFeatures(undefined, { layers: [BUILDING_LAYER_ID] }) || [];
  } catch (error) {
    return null;
  }

  let bestMatch = null;

  features.forEach((feature, index) => {
    const polygons = getFeaturePolygons(feature.geometry);
    polygons.forEach((ringSet) => {
      const outerRing = ringSet?.[0];
      if (!outerRing?.length) return;

      const distanceM = getDistanceFromCenterToRing(center, outerRing);
      if (distanceM > searchRadiusM) return;

      const height = parseFloat(feature.properties?.render_height || feature.properties?.height || 8);
      const centroid = getRingCentroid(outerRing);
      const candidate = {
        id: `detected-building-${index}`,
        kind: 'user-detected',
        lat: centroid.lat,
        lng: centroid.lng,
        height: Number.isFinite(height) ? height : 8,
        footprint: outerRing.map(([lng, lat]) => ({ lat, lng })),
        distanceM,
      };

      if (!bestMatch || candidate.distanceM < bestMatch.distanceM) {
        bestMatch = candidate;
      }
    });
  });

  return bestMatch;
}

function addMapInteractionHint(map, customText) {
  const container = map.getContainer();
  if (container.querySelector(`.${MAP_INTERACTION_HINT_CLASS}`)) {
    return;
  }

  const hint = document.createElement('div');
  hint.className = MAP_INTERACTION_HINT_CLASS;
  if (customText) {
    hint.textContent = customText;
  } else {
    const label = document.createElement('strong');
    label.textContent = 'Map controls:';
    hint.appendChild(label);
    hint.appendChild(document.createTextNode(' drag to pan, scroll to zoom, and right- or middle-drag to rotate. Use the compass to return north-up.'));
  }
  container.appendChild(hint);
}

function enableMiddleButtonOrbit(map) {
  const canvas = map.getCanvas();
  if (!canvas) return;

  let dragState = null;

  const handleMouseMove = (event) => {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;

    map.stop();
    map.jumpTo({
      bearing: dragState.startBearing + (dx * 0.35),
      pitch: clamp(dragState.startPitch - (dy * 0.24), 0, 80),
    });
  };

  const handleMouseUp = () => {
    if (!dragState) return;
    dragState = null;
    canvas.style.cursor = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDown = (event) => {
    if (event.button !== 1) return;

    event.preventDefault();
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      startBearing: map.getBearing(),
      startPitch: map.getPitch(),
    };

    canvas.style.cursor = 'grabbing';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const preventAuxClick = (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('auxclick', preventAuxClick);

  map.on('remove', () => {
    handleMouseUp();
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('auxclick', preventAuxClick);
  });
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

function getBuildingPreviewRing(building) {
  if (building?.footprint?.length >= 3) {
    return ensureClosedRing(building.footprint);
  }

  if (!Number.isFinite(building?.lat) || !Number.isFinite(building?.lng) || building.frontDoorFacing == null) {
    return null;
  }

  return getRectangleRing(
    building.lat,
    building.lng,
    building.widthM || 5,
    building.depthM || 9,
    building.frontDoorFacing
  );
}

function ensureClosedRing(ring) {
  if (!ring.length) return ring;

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) {
    return ring;
  }

  return [...ring, first];
}

function getDistanceFromCenterToRing(center, outerRing) {
  const polygon = outerRing.map(([lng, lat]) => {
    const { dx, dy } = latLngToMeters(center.lat, center.lng, lat, lng);
    return { x: dx, y: dy };
  });
  const point = { x: 0, y: 0 };

  if (pointInPolygon(point, polygon)) {
    return 0;
  }

  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    minDistance = Math.min(minDistance, distancePointToSegment(point, start, end));
  }

  return minDistance;
}

function createBuildingFingerprint(building) {
  return `${Number(building?.lat || 0).toFixed(6)}:${Number(building?.lng || 0).toFixed(6)}:${Math.round(Number(building?.height || 0))}`;
}

function areRingsLikelySameBuilding(referenceRing, candidateRing) {
  if (!referenceRing?.length || !candidateRing?.length) return false;

  const referenceCentroid = getRingCentroid(referenceRing);
  const candidateCentroid = getRingCentroid(candidateRing);
  const { dx, dy } = latLngToMeters(referenceCentroid.lat, referenceCentroid.lng, candidateCentroid.lat, candidateCentroid.lng);
  const centroidDistanceM = Math.hypot(dx, dy);

  if (centroidDistanceM > 4) return false;

  const referenceDistance = getDistanceFromCenterToRing(referenceCentroid, candidateRing);
  const candidateDistance = getDistanceFromCenterToRing(candidateCentroid, referenceRing);
  return Math.max(referenceDistance, candidateDistance) < 4;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
