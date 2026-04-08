import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';
import { degreesToCompass, getBearingBetweenPoints, getRectangleRing, latLngToMeters, metersToLatLng, normalizeDegrees } from '../utils/geometry.js';
import { getMapLightFromSun, samplePlacementHeatmap } from '../utils/sun.js';
import { createPanelMarkerElement, createStepMap, drawBuildingFootprintPreview, drawObstacles, drawSuitabilityHeatmap, normalizeObstacles, updatePanelMarkerElement } from '../utils/map-helpers.js';

let map = null;
let activeMode = 'space';
let activeObstacleTool = 'fence';
let pendingPlacement = null;
let fenceStartPoint = null;
let drawnSpaces = [];
let drawnObstacles = [];
let markers = [];
let spaceCounter = 0;
let obstacleCounter = 0;
let selectedSpaceId = null;
let heatmapRefreshHandle = null;
let heatmapIdleHandle = null;
let initialSceneReady = false;

const SURFACE_SNAP_DISTANCE_M = 6;
const WALL_SNAP_DISTANCE_M = 5;
const PANEL_SNAP_OFFSET_M = 0.8;

const spaceTypes = [
  { id: 'railing', icon: '🏗️', label: 'Balcony Railing' },
  { id: 'wall', icon: '🧱', label: 'Wall Mount' },
  { id: 'fence', icon: '☀️', label: 'Fence Mount' },
  { id: 'flat-roof', icon: '🏠', label: 'Flat Roof / Shed' },
  { id: 'ground', icon: '🌿', label: 'Ground / Garden' },
];

const obstacleTools = [
  { id: 'fence', label: 'Fence', icon: '🟧' },
  { id: 'tree', label: 'Tree', icon: '🌳' },
  { id: 'shed', label: 'Shed / Wall', icon: '⬜' },
];

const SHED_DIRECTION_OPTIONS = [
  { label: 'N', deg: 0 },
  { label: 'NE', deg: 45 },
  { label: 'E', deg: 90 },
  { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 },
  { label: 'SW', deg: 225 },
  { label: 'W', deg: 270 },
  { label: 'NW', deg: 315 },
];

export function render() {
  const obstacleCount = (getState('obstacles') || []).length;

  return `
    <div class="step-page step-page-map">
      <div class="step-header">
        <div class="section-kicker">Step 3 · Placement</div>
        <h2 class="step-title">Choose Panel Locations</h2>
        <p class="step-subtitle">Add the candidate panel spots you want us to compare. Your site obstacles from the previous step are already applied to the map.</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="spaces-map"></div>
        <div class="map-loading-overlay" id="placement-map-loading">
          <div class="loading-spinner"></div>
          <div id="placement-map-loading-text">Loading placement surface…</div>
        </div>
        <div class="map-overlay-bottom map-overlay-bottom-legend">
          <div class="map-legend-title">Heatmap guide</div>
          <div class="map-legend-copy">The surface is a direct-sun guide. Green means stronger year-round exposure, amber means mixed, and red means weaker.</div>
          <div class="analysis-note" id="heatmap-status" style="margin-top: 8px;">Rendering suitability surface…</div>
        </div>

        <div class="map-placement-banner hidden" id="placement-banner">
          <span id="placement-banner-text">Click the map to place</span>
          <button class="btn btn-sm btn-secondary" id="btn-cancel-placement" style="padding: 4px 12px; font-size: 0.75rem;">✕ Cancel</button>
        </div>

        <div class="map-overlay-panel map-overlay-panel-planner">
          <div class="map-panel-header">
            <div>
              <div class="map-panel-kicker">Panel Placement</div>
              <h3 class="map-panel-title">Candidate panel locations</h3>
            </div>
            <div class="map-panel-pill">${obstacleCount} site obstacles</div>
          </div>

          <h4 style="margin-bottom: 12px;">Add Panel Locations</h4>

          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px;">
            Add at least one candidate panel spot. Each marker stores its own orientation and tilt, and the heatmap shows where direct sun is strongest around the property.
          </p>

          <div class="form-group mb-md">
            <label class="form-label">Surface type</label>
            <div class="space-type-grid">
              ${spaceTypes.map((type) => `
                <button class="space-type-btn ${type.id === 'ground' ? 'active' : ''}" data-type="${type.id}">
                  <span class="type-icon">${type.icon}</span>
                  ${type.label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Panel facing</label>
            <div class="flex items-center gap-md">
              <input type="range" class="range-slider" id="orientation-slider"
                     min="0" max="360" value="180" />
              <span id="orientation-value" style="min-width: 108px; text-align: right; font-weight: 600;">South (180°)</span>
            </div>
            <div class="analysis-note" id="orientation-note" style="margin-top: 8px;">
              Pick the general facing if you know it. Fence-mounted panels snap to saved fences, and wall mounts snap to the selected property outline.
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Panel tilt (°)</label>
            <div class="flex items-center gap-md">
              <input type="range" class="range-slider" id="tilt-slider"
                     min="0" max="90" value="35" />
              <span id="tilt-value" style="min-width: 36px; text-align: right; font-weight: 600;">35°</span>
            </div>
          </div>

          <button class="btn btn-primary w-full mb-md" id="btn-add-space">
            📌 Place Panel Marker
          </button>

          <div class="analysis-note mb-md" id="placement-status">
            Click the button, then drop candidate panel locations onto the map. To edit fences, sheds, or trees, go back to Site Setup.
          </div>

          <div class="analysis-note mb-md">
            Fence and wall snaps show a coloured alignment strip under the marker so you can see when it has locked onto a real surface.
          </div>

          <div id="obstacles-list"></div>
          <div id="spaces-list"></div>
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-spaces">← Back</button>
        <button class="btn btn-primary" id="btn-next-spaces" disabled>
          Continue →
        </button>
      </div>
    </div>
  `;
}

export function init() {
  const location = getState('location');
  if (!location) return;

  drawnSpaces = [...(getState('spaces') || [])];
  drawnObstacles = normalizeObstacles(getState('obstacles') || []);
  selectedSpaceId = getState('selectedSpaceId') || drawnSpaces[0]?.id || null;
  spaceCounter = drawnSpaces.length;
  obstacleCounter = drawnObstacles.length;
  initialSceneReady = false;

  initMap(location);
  initControls();
  updateObstaclesList();
  updateSpacesList();
  updateNextButton();
  updatePlacementStatus('Click the button, then drop candidate panel locations onto the map. To edit fences, sheds, or trees, go back to Site Setup.');

  document.getElementById('btn-back-spaces')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-spaces')?.addEventListener('click', () => {
    setState({
      spaces: drawnSpaces,
      obstacles: drawnObstacles,
      selectedSpaceId: getEffectiveSelectedSpaceId(),
    });
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initMap(location) {
  const mapCenter = getPlacementCenter(location);
  map = createStepMap({
    container: 'spaces-map',
    center: [mapCenter.lng, mapCenter.lat],
    zoom: 18.6,
    pitch: 55,
    bearing: -24,
    onLoad: () => {
      showPlacementMapLoading('Positioning map…');
      drawHousePreview();
      refreshObstaclesAfterSettledPaint();
      drawnSpaces.forEach((space) => addMarkerToMap(space));
      applyPlacementSceneLighting();
      fitMapToPlacementSite(() => {
        showPlacementMapLoading('Loading site objects…');
        applyPlacementSceneLighting();
        refreshPanelMarkers();
        hidePlacementMapLoading();
        queueHeatmapRefresh({ fastMode: true, immediate: true });
        refreshObstaclesAfterSettledPaint(() => {
          if (!initialSceneReady) {
            queueHeatmapRefresh({ fastMode: true, immediate: true });
          }
        });
      });
    },
  });

  map.on('click', (e) => {
    handleMapClick(e.lngLat.lat, e.lngLat.lng);
  });

  map.on('rotate', () => {
    refreshPanelMarkers();
  });
}

function initControls() {
  document.querySelectorAll('.space-type-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.space-type-btn').forEach((chip) => chip.classList.remove('active'));
      button.classList.add('active');
      updateOrientationNote(button.dataset.type);
    });
  });

  const orientSlider = document.getElementById('orientation-slider');
  const orientValue = document.getElementById('orientation-value');
  orientSlider?.addEventListener('input', () => {
    const deg = parseInt(orientSlider.value, 10);
    orientValue.textContent = `${degreesToCompass(deg, 'long')} (${deg}°)`;
  });

  const tiltSlider = document.getElementById('tilt-slider');
  const tiltValue = document.getElementById('tilt-value');
  tiltSlider?.addEventListener('input', () => {
    tiltValue.textContent = `${tiltSlider.value}°`;
  });

  document.querySelectorAll('[data-shed-rotation]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = parseInt(button.dataset.shedRotation, 10);
      setShedRotation(Number.isFinite(value) ? value : 0);
    });
  });

  document.getElementById('shed-rotation-slider')?.addEventListener('input', (event) => {
    const value = parseInt(event.target.value, 10);
    setShedRotation(Number.isFinite(value) ? value : 0);
  });

  document.getElementById('btn-add-space')?.addEventListener('click', () => {
    setPendingPlacement('space');
  });

  document.getElementById('btn-cancel-placement')?.addEventListener('click', () => {
    cancelPlacement();
    updatePlacementStatus('Placement cancelled.');
  });

  document.addEventListener('keydown', handleEscapeKey);
  updateOrientationNote(document.querySelector('.space-type-btn.active')?.dataset.type || 'ground');
}

function setActiveMode(mode) {
  activeMode = mode === 'obstacle' ? 'obstacle' : 'space';
  cancelPlacement();

  document.querySelectorAll('.mode-switch-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === activeMode);
  });

  document.getElementById('panel-mode-panel')?.classList.toggle('hidden', activeMode !== 'space');
  document.getElementById('obstacle-mode-panel')?.classList.toggle('hidden', activeMode !== 'obstacle');

  updatePlacementStatus('Choose a mode, then click the action button to place items on the map.');
}

function setActiveObstacleTool(tool) {
  activeObstacleTool = obstacleTools.find((entry) => entry.id === tool)?.id || 'fence';
  cancelPlacement();

  document.querySelectorAll('[data-obstacle-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.obstacleTool === activeObstacleTool);
  });

  document.querySelectorAll('[data-config-tool]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.configTool !== activeObstacleTool);
  });

  const actionBtn = document.getElementById('btn-place-obstacle');
  if (actionBtn) {
    if (activeObstacleTool === 'tree') actionBtn.textContent = '🌳 Place Tree';
    else if (activeObstacleTool === 'shed') actionBtn.textContent = '⬜ Place Shed / Wall';
    else actionBtn.textContent = '🟧 Draw Fence';
  }
}

function setPendingPlacement(mode) {
  if (pendingPlacement === mode && (mode !== 'fence' || fenceStartPoint == null)) {
    cancelPlacement();
    return;
  }

  pendingPlacement = mode;
  fenceStartPoint = null;

  if (map) {
    map.getCanvas().style.cursor = 'crosshair';
  }

  let bannerText = 'Click the map to place';
  if (mode === 'space') {
    bannerText = '📌 Click the map to drop a panel location';
    updatePlacementStatus('Click on the map to drop a panel location.');
  } else if (mode === 'tree') {
    bannerText = '🌳 Click the map to place the tree';
    updatePlacementStatus('Click on the map to place the tree marker.');
  } else if (mode === 'shed') {
    bannerText = '⬜ Click the map to place the shed centre';
    updatePlacementStatus('Click on the map to place the shed footprint centre.');
  } else {
    bannerText = '🟧 Click the fence start point';
    updatePlacementStatus('Click the fence start point, then click the fence end point.');
  }

  showPlacementBanner(bannerText);
  updateCancelFenceButton();
}

function cancelPlacement() {
  pendingPlacement = null;
  fenceStartPoint = null;

  if (map) {
    map.getCanvas().style.cursor = '';
  }

  hidePlacementBanner();
  updateCancelFenceButton();
}

function handleMapClick(lat, lng) {
  if (pendingPlacement !== 'space') return;

  const space = addSpace(lat, lng);
  cancelPlacement();
  updatePlacementStatus(space?.alignmentHint ? `${space.alignmentHint}.` : 'Panel marker added.');
}

function addSpace(lat, lng) {
  spaceCounter += 1;
  const activeType = document.querySelector('.space-type-btn.active');
  const typeId = activeType?.dataset.type || 'ground';
  const typeInfo = spaceTypes.find((type) => type.id === typeId);
  const manualOrientation = parseInt(document.getElementById('orientation-slider')?.value || 180, 10);
  const tilt = parseInt(document.getElementById('tilt-slider')?.value || 35, 10);
  const surfaceAlignment = resolveSurfaceAlignment(typeId, lat, lng);
  const orientation = surfaceAlignment?.orientation ?? manualOrientation;
  const displayRotation = surfaceAlignment?.displayRotation ?? orientation;
  const centerLat = surfaceAlignment?.lat ?? lat;
  const centerLng = surfaceAlignment?.lng ?? lng;

  const space = {
    id: `space-${spaceCounter}`,
    name: `${typeInfo?.label || 'Space'} ${spaceCounter}`,
    type: typeId,
    typeIcon: typeInfo?.icon || '📍',
    centerLat,
    centerLng,
    orientation,
    displayRotation,
    tilt,
    orientationLabel: `${degreesToCompass(orientation, 'long')} (${orientation}°)`,
    alignmentHint: surfaceAlignment?.hint || null,
    surfaceAligned: surfaceAlignment?.surfaceAligned === true,
  };

  drawnSpaces.push(space);
  if (!selectedSpaceId) {
    selectedSpaceId = space.id;
  }
  addMarkerToMap(space);
  applyMarkerSelectionStyles();
  updateSpacesList();
  updateNextButton();
  return space;
}

function addFence(startPoint, endPoint) {
  obstacleCounter += 1;
  drawnObstacles.push({
    id: `obstacle-${obstacleCounter}`,
    type: 'fence',
    points: [startPoint, endPoint],
    heightM: parseFloat(document.getElementById('fence-height')?.value || 1.8),
  });
  refreshObstacles();
  queueHeatmapRefresh();
  updateObstaclesList();
}

function addTree(lat, lng) {
  obstacleCounter += 1;
  drawnObstacles.push({
    id: `obstacle-${obstacleCounter}`,
    type: 'tree',
    lat,
    lng,
    heightM: parseFloat(document.getElementById('tree-height')?.value || 5),
    canopyRadiusM: parseFloat(document.getElementById('tree-radius')?.value || 3),
  });
  refreshObstacles();
  queueHeatmapRefresh();
  updateObstaclesList();
}

function addShed(lat, lng) {
  obstacleCounter += 1;
  drawnObstacles.push({
    id: `obstacle-${obstacleCounter}`,
    type: 'shed',
    lat,
    lng,
    heightM: parseFloat(document.getElementById('shed-height')?.value || 2.5),
    widthM: parseFloat(document.getElementById('shed-width')?.value || 3),
    depthM: parseFloat(document.getElementById('shed-depth')?.value || 2),
    rotationDeg: getShedRotation(),
  });
  refreshObstacles();
  queueHeatmapRefresh();
  updateObstaclesList();
}

function addMarkerToMap(space) {
  const el = createPanelMarkerElement(space, {
    onClick: (event) => {
      event.stopPropagation();
      selectSpace(space.id);
    },
  });

  const marker = new maplibregl.Marker({
    element: el,
    anchor: 'center',
    pitchAlignment: 'map',
    rotationAlignment: 'map',
  })
    .setLngLat([space.centerLng, space.centerLat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
      <strong>${space.name}</strong><br/>
      <span style="font-size: 0.8rem; color: #94A3B8;">
        ${space.orientationLabel} · ${space.tilt}° tilt${space.alignmentHint ? ` · ${space.alignmentHint}` : ''}
      </span>
    `))
    .addTo(map);

  markers.push({ id: space.id, marker, element: el });
  applyMarkerSelectionStyles();
}

function refreshObstacles() {
  if (map?.isStyleLoaded()) {
    drawObstacles(map, drawnObstacles);
  }
}

function refreshObstaclesAfterSettledPaint(onDone) {
  if (!map) {
    onDone?.();
    return;
  }

  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    refreshObstaclesDeferred(onDone);
  };

  refreshObstacles();

  if (typeof map.once === 'function') {
    map.once('idle', finish);
    window.setTimeout(finish, 180);
    return;
  }

  finish();
}

function refreshObstaclesDeferred(onDone) {
  const run = () => {
    refreshObstacles();
    onDone?.();
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return;
  }

  window.setTimeout(run, 0);
}

function renderPlacementScene(options = {}) {
  if (!map?.isStyleLoaded()) return;
  refreshObstacles();
  queueHeatmapRefresh(options);
}

function queueHeatmapRefresh(options = {}) {
  cancelScheduledHeatmapRefresh();
  setHeatmapStatus('Rendering suitability surface…');

  const delay = options.immediate ? 40 : 170;
  heatmapRefreshHandle = window.setTimeout(() => {
    const runRender = () => {
      heatmapIdleHandle = null;
      heatmapRefreshHandle = null;

      try {
        if (!map?.isStyleLoaded()) {
          hidePlacementMapLoading();
          setHeatmapStatus('Suitability surface unavailable.');
          return;
        }

        const center = getHeatmapCenter();
        const buildings = getState('buildings') || [];
        const featureCollection = samplePlacementHeatmap(center.lat, center.lng, buildings, drawnObstacles, {
          radiusM: 14,
          stepM: 2.5,
          fastMode: options.fastMode === true,
        });
        drawSuitabilityHeatmap(map, featureCollection);
        refreshObstacles();
        setHeatmapStatus('Suitability surface ready.');
        initialSceneReady = true;
        refreshPanelMarkers();
      } catch (error) {
        console.error('Failed to render placement heatmap:', error);
        setHeatmapStatus('Suitability surface failed to load.');
      }
    };

    if (!options.immediate && typeof window.requestIdleCallback === 'function') {
      heatmapIdleHandle = window.requestIdleCallback(runRender, { timeout: 360 });
      return;
    }

    runRender();
  }, delay);
}

function selectSpace(spaceId) {
  selectedSpaceId = spaceId;
  applyMarkerSelectionStyles();
  updateSpacesList();
  setState({ selectedSpaceId: spaceId });
}

function applyMarkerSelectionStyles() {
  refreshPanelMarkers();
}

function refreshPanelMarkers() {
  markers.forEach((entry) => {
    const isSelected = entry.id === selectedSpaceId;
    const space = drawnSpaces.find((item) => item.id === entry.id) || { id: entry.id };
    updatePanelMarkerElement(entry.element, space, {
      selected: isSelected,
      rotation: getMarkerScreenRotation(space),
    });
  });
}

function updateSpacesList() {
  const listEl = document.getElementById('spaces-list');
  if (!listEl) return;

  if (drawnSpaces.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = `
    <h4 style="margin-bottom: 10px; font-size: 0.9rem; color: var(--text-secondary);">
      Added Locations (${drawnSpaces.length})
    </h4>
    ${drawnSpaces.map((space) => `
      <div class="card-flat compact-row ${space.id === selectedSpaceId ? 'analysis-card-best' : ''}">
        <div>
          <span>${space.typeIcon}</span>
          <strong style="font-size: 0.85rem;">${space.name}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            ${space.orientationLabel} · ${space.tilt}° tilt${space.alignmentHint ? ` · ${space.alignmentHint}` : ''}
          </div>
        </div>
        <div class="badge-row">
          <button class="btn btn-sm btn-outline select-space-btn" data-id="${space.id}" style="padding: 4px 10px; font-size: 0.75rem;">
            ${space.id === selectedSpaceId ? 'Selected' : 'Use This'}
          </button>
          <button class="btn btn-sm btn-secondary remove-space-btn" data-id="${space.id}" style="padding: 4px 10px; font-size: 0.75rem;">✕</button>
        </div>
      </div>
    `).join('')}
  `;

  listEl.querySelectorAll('.select-space-btn').forEach((button) => {
    button.addEventListener('click', () => {
      selectSpace(button.dataset.id);
    });
  });

  listEl.querySelectorAll('.remove-space-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      drawnSpaces = drawnSpaces.filter((space) => space.id !== id);

      const markerObj = markers.find((entry) => entry.id === id);
      if (markerObj) {
        markerObj.marker.remove();
        markers = markers.filter((entry) => entry.id !== id);
      }

      if (selectedSpaceId === id) {
        selectedSpaceId = drawnSpaces[0]?.id || null;
      }

      updateSpacesList();
      applyMarkerSelectionStyles();
      updateNextButton();
    });
  });
}

function updateObstaclesList() {
  const listEl = document.getElementById('obstacles-list');
  if (!listEl) return;

  if (drawnObstacles.length === 0) {
    listEl.innerHTML = `
      <div class="card-flat card-flat-subtle" style="padding: 12px; margin: 0 0 14px;">
        <div style="font-weight: 600; margin-bottom: 4px;">Site obstacles</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary);">
          No fences, sheds, or trees have been carried into this step yet. Go back to Site Setup if you need to add them.
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = `
    <h4 style="margin: 0 0 10px; font-size: 0.9rem; color: var(--text-secondary);">
      Site Obstacles (${drawnObstacles.length})
    </h4>
    <div class="analysis-note mb-md" style="margin-bottom: 12px;">
      These are the fences, sheds, and trees from Site Setup. They are read-only here and used for placement snapping and shadow scoring.
    </div>
    ${drawnObstacles.map((obstacle) => `
      <div class="card-flat compact-row">
        <div>
          <strong style="font-size: 0.85rem;">${formatObstacleLabel(obstacle)}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            ${formatObstacleDetails(obstacle)}
          </div>
        </div>
        <div class="obstacle-action-group">
          ${obstacle.type === 'shed' ? `
            <button class="btn btn-sm btn-outline rotate-obstacle-btn" data-id="${obstacle.id}" data-rotate="-15" style="padding: 4px 10px; font-size: 0.75rem;">↺ 15°</button>
            <button class="btn btn-sm btn-outline rotate-obstacle-btn" data-id="${obstacle.id}" data-rotate="15" style="padding: 4px 10px; font-size: 0.75rem;">↻ 15°</button>
          ` : ''}
          <button class="btn btn-sm btn-secondary remove-obstacle-btn" data-id="${obstacle.id}" style="padding: 4px 10px; font-size: 0.75rem;">✕</button>
        </div>
      </div>
    `).join('')}
  `;

  listEl.querySelectorAll('.rotate-obstacle-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const delta = parseInt(button.dataset.rotate || '0', 10);
      if (!Number.isFinite(delta)) return;
      rotateShed(button.dataset.id, delta);
    });
  });

  listEl.querySelectorAll('.remove-obstacle-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      drawnObstacles = drawnObstacles.filter((obstacle) => obstacle.id !== id);
      refreshObstacles();
      queueHeatmapRefresh();
      updateObstaclesList();
    });
  });
}

function formatObstacleLabel(obstacle) {
  if (obstacle.type === 'tree') return '🌳 Tree';
  if (obstacle.type === 'shed') return '⬜ Shed / Wall';
  return '🟧 Fence';
}

function formatObstacleDetails(obstacle) {
  if (obstacle.type === 'tree') {
    return `${obstacle.heightM}m high · ${obstacle.canopyRadiusM}m canopy radius`;
  }

  if (obstacle.type === 'shed') {
    return `${obstacle.widthM}m × ${obstacle.depthM}m · ${obstacle.heightM}m high · facing ${degreesToCompass(obstacle.rotationDeg || 0, 'long')} (${Math.round(obstacle.rotationDeg || 0)}°)`;
  }

  return `${obstacle.heightM}m high line`;
}

function setShedRotation(value) {
  const slider = document.getElementById('shed-rotation-slider');
  if (slider) {
    slider.value = String(value);
  }
  updateShedRotationUI();
}

function getShedRotation() {
  const value = parseInt(document.getElementById('shed-rotation-slider')?.value || 0, 10);
  return Number.isFinite(value) ? value : 0;
}

function updateShedRotationUI() {
  const rotation = getShedRotation();
  const valueEl = document.getElementById('shed-rotation-value');
  const noteEl = document.getElementById('shed-rotation-note');

  document.querySelectorAll('[data-shed-rotation]').forEach((chip) => {
    chip.classList.toggle('active', parseInt(chip.dataset.shedRotation, 10) === rotation);
  });

  if (valueEl) {
    valueEl.textContent = `${degreesToCompass(rotation, 'long')} (${rotation}°)`;
  }

  if (noteEl) {
    noteEl.textContent = `Shed front set to ${degreesToCompass(rotation, 'long')}. Place it on the map when the direction looks right.`;
  }
}

function rotateShed(obstacleId, deltaDeg) {
  drawnObstacles = drawnObstacles.map((obstacle) => {
    if (obstacle.id !== obstacleId || obstacle.type !== 'shed') {
      return obstacle;
    }

    return {
      ...obstacle,
      rotationDeg: normalizeDegrees((obstacle.rotationDeg || 0) + deltaDeg),
    };
  });

  refreshObstacles();
  queueHeatmapRefresh();
  updateObstaclesList();
}

function updateNextButton() {
  const btn = document.getElementById('btn-next-spaces');
  if (btn) {
    btn.disabled = drawnSpaces.length === 0;
  }
}

function updatePlacementStatus(message) {
  const statusEl = document.getElementById('placement-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function showPlacementBanner(text) {
  const banner = document.getElementById('placement-banner');
  const bannerText = document.getElementById('placement-banner-text');
  if (banner) {
    banner.classList.remove('hidden');
    if (bannerText) bannerText.textContent = text;
  }
}

function hidePlacementBanner() {
  const banner = document.getElementById('placement-banner');
  if (banner) banner.classList.add('hidden');
}

function updateCancelFenceButton() {
  const cancelBtn = document.getElementById('btn-cancel-fence');
  if (cancelBtn) {
    const showCancel = pendingPlacement === 'fence' || fenceStartPoint != null;
    cancelBtn.classList.toggle('hidden', !showCancel);
  }
}

function handleEscapeKey(e) {
  if (e.key === 'Escape' && (pendingPlacement || fenceStartPoint)) {
    cancelPlacement();
    updatePlacementStatus('Placement cancelled.');
  }
}

function updateOrientationNote(typeId) {
  const noteEl = document.getElementById('orientation-note');
  if (!noteEl) return;

  if (typeId === 'fence') {
    noteEl.textContent = 'Fence-mounted panels snap onto the nearest drawn fence. Successful snaps show an amber alignment strip beneath the marker.';
    return;
  }

  if (typeId === 'wall') {
    noteEl.textContent = getPrimaryBuildingFootprint().length >= 3
      ? 'Click near a house wall to snap the panel onto that wall. Successful snaps show a blue alignment strip beneath the marker.'
      : 'Set the house direction first if you want wall mounts to snap to the house outline.';
    return;
  }

  noteEl.textContent = 'Pick the general facing if you know it. Fence-mounted panels snap to fences, and wall mounts snap to the house outline.';
}

function getNearestFenceAlignment(lat, lng) {
  const fences = drawnObstacles.filter((obstacle) => obstacle.type === 'fence' && obstacle.points?.length >= 2);
  if (!fences.length) return null;

  const scored = fences.map((fence) => {
    const start = fence.points[0];
    const end = fence.points[1];
    return getSurfaceAlignment(start, end, lat, lng, {
      hint: 'Snapped to nearby fence',
      offsetM: PANEL_SNAP_OFFSET_M,
      surfaceType: 'fence',
    });
  }).sort((a, b) => a.distanceM - b.distanceM);

  return scored[0]?.distanceM <= SURFACE_SNAP_DISTANCE_M ? scored[0] : null;
}

function drawHousePreview() {
  const userBuilding = getPrimaryBuilding();
  if (!map?.isStyleLoaded() || !userBuilding) return;
  drawBuildingFootprintPreview(map, userBuilding);
}

function fitMapToPlacementSite(onComplete) {
  if (!map?.isStyleLoaded()) {
    onComplete?.();
    return;
  }

  const bounds = getPlacementBounds();
  if (!bounds) {
    onComplete?.();
    return;
  }

  const desktop = window.innerWidth >= 1024;
  let completed = false;
  let fallbackTimer = null;

  const finish = () => {
    if (completed) return;
    completed = true;
    map.off('moveend', handleMoveEnd);
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    onComplete?.();
  };

  const handleMoveEnd = () => {
    finish();
  };

  map.on('moveend', handleMoveEnd);
  fallbackTimer = window.setTimeout(finish, 1000);

  try {
    map.fitBounds(bounds, {
      padding: desktop
        ? { top: 72, right: 88, bottom: 96, left: 470 }
        : { top: 72, right: 24, bottom: 148, left: 24 },
      maxZoom: 19.6,
      pitch: 55,
      bearing: -24,
      duration: 750,
      essential: true,
    });
  } catch (error) {
    finish();
  }
}

function applyPlacementSceneLighting() {
  const location = getState('location');
  if (!map?.isStyleLoaded() || !location) return;

  const center = getHeatmapCenter();
  const lightTime = new Date();
  lightTime.setMonth(5, 21);
  lightTime.setHours(14, 30, 0, 0);

  const lightProps = getMapLightFromSun(lightTime, center.lat, center.lng);

  try {
    map.setLight({
      anchor: 'map',
      position: [1.5, lightProps.position[1], Math.max(12, lightProps.position[2])],
      intensity: Math.max(0.52, lightProps.intensity),
      color: lightProps.color,
    });
  } catch (error) {
    // Style/light support varies slightly by renderer; placement still works without explicit light control.
  }
}

function getPlacementCenter(location) {
  const userBuilding = getPrimaryBuilding();
  if (Number.isFinite(userBuilding?.lat) && Number.isFinite(userBuilding?.lng)) {
    return { lat: userBuilding.lat, lng: userBuilding.lng };
  }

  return location;
}

function getHeatmapCenter() {
  const userBuilding = getPrimaryBuilding();
  if (Number.isFinite(userBuilding?.lat) && Number.isFinite(userBuilding?.lng)) {
    return { lat: userBuilding.lat, lng: userBuilding.lng };
  }

  const center = map?.getCenter();
  return center
    ? { lat: center.lat, lng: center.lng }
    : getPlacementCenter(getState('location'));
}

function getPlacementBounds() {
  const points = [];
  const propertyFootprint = getPrimaryBuildingFootprint();
  propertyFootprint.forEach((point) => {
    if (Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) {
      points.push(point);
    }
  });

  drawnObstacles.forEach((obstacle) => {
    if (obstacle.type === 'fence' && obstacle.points?.length) {
      obstacle.points.forEach((point) => {
        if (Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) {
          points.push(point);
        }
      });
      return;
    }

    if (obstacle.type === 'shed' && Number.isFinite(obstacle.lat) && Number.isFinite(obstacle.lng)) {
      const ring = getRectangleRing(
        obstacle.lat,
        obstacle.lng,
        obstacle.widthM || 3,
        obstacle.depthM || 2,
        obstacle.rotationDeg || 0
      );
      ring.forEach((point) => points.push(point));
      return;
    }

    if (Number.isFinite(obstacle.lat) && Number.isFinite(obstacle.lng)) {
      points.push({ lat: obstacle.lat, lng: obstacle.lng });
    }
  });

  if (!points.length) return null;

  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  points.forEach((point) => {
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  });

  if (![west, east, south, north].every(Number.isFinite)) {
    return null;
  }

  return [[west, south], [east, north]];
}

function getMarkerScreenRotation(space) {
  const worldRotation = space.displayRotation ?? space.orientation ?? 180;
  return normalizeDegrees(worldRotation - (map?.getBearing() || 0));
}

function cancelScheduledHeatmapRefresh() {
  if (heatmapRefreshHandle) {
    window.clearTimeout(heatmapRefreshHandle);
    heatmapRefreshHandle = null;
  }

  if (heatmapIdleHandle && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(heatmapIdleHandle);
    heatmapIdleHandle = null;
  }
}

function setHeatmapStatus(message) {
  const statusEl = document.getElementById('heatmap-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function showPlacementMapLoading(message) {
  const overlay = document.getElementById('placement-map-loading');
  const textEl = document.getElementById('placement-map-loading-text');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  if (textEl && message) {
    textEl.textContent = message;
  }
}

function hidePlacementMapLoading() {
  document.getElementById('placement-map-loading')?.classList.add('hidden');
}

function getPrimaryBuilding() {
  return (getState('buildings') || []).find((building) => building.kind === 'user' || building.id === 'user-building') || null;
}

function getPrimaryBuildingFootprint() {
  const building = getPrimaryBuilding();
  if (!building) return [];

  if (building.footprint?.length >= 3) {
    return building.footprint;
  }

  if (Number.isFinite(building.lat) && Number.isFinite(building.lng) && Number.isFinite(building.frontDoorFacing)) {
    return getRectangleRing(
      building.lat,
      building.lng,
      building.widthM || 5,
      building.depthM || 9,
      building.frontDoorFacing
    ).slice(0, -1);
  }

  return [];
}

function resolveSurfaceAlignment(typeId, lat, lng) {
  if (typeId === 'fence') {
    return getNearestFenceAlignment(lat, lng);
  }

  if (typeId === 'wall') {
    return getNearestWallAlignment(lat, lng);
  }

  return null;
}

function getNearestWallAlignment(lat, lng) {
  const footprint = getPrimaryBuildingFootprint();
  if (footprint.length < 3) return null;

  const centroid = getPointCentroid(footprint);
  const scored = footprint.map((point, index) => {
    const next = footprint[(index + 1) % footprint.length];
    return getSurfaceAlignment(point, next, lat, lng, {
      hint: 'Snapped to house wall',
      offsetM: PANEL_SNAP_OFFSET_M,
      outwardReference: centroid,
      surfaceType: 'wall',
    });
  }).sort((a, b) => a.distanceM - b.distanceM);

  return scored[0]?.distanceM <= WALL_SNAP_DISTANCE_M ? scored[0] : null;
}

function getSurfaceAlignment(start, end, lat, lng, options = {}) {
  const projection = projectToSegmentMeters(lat, lng, start, end);
  const baseBearing = normalizeDegrees(Math.round(getBearingBetweenPoints(start.lat, start.lng, end.lat, end.lng)));
  const facing = normalizeDegrees(Math.round(resolveFacingBearing(baseBearing, projection, start, options.outwardReference)));
  const offsetVector = getBearingVector(facing);
  const snappedPoint = metersToLatLng(
    start.lat,
    start.lng,
    projection.projX + (offsetVector.dx * (options.offsetM ?? 0)),
    projection.projY + (offsetVector.dy * (options.offsetM ?? 0))
  );

  return {
    distanceM: projection.distanceM,
    orientation: facing,
    displayRotation: baseBearing,
    lat: snappedPoint.lat,
    lng: snappedPoint.lng,
    hint: options.hint ? `${options.hint} · ${getSurfaceLineLabel(baseBearing)}` : null,
    surfaceType: options.surfaceType || null,
    surfaceAligned: true,
  };
}

function getSurfaceLineLabel(bearing) {
  const forward = degreesToCompass(bearing, 'short');
  const reverse = degreesToCompass(bearing + 180, 'short');
  return `${forward}-${reverse} line`;
}

function projectToSegmentMeters(lat, lng, start, end) {
  const endMeters = latLngToMeters(start.lat, start.lng, end.lat, end.lng);
  const pointMeters = latLngToMeters(start.lat, start.lng, lat, lng);
  const segLenSq = (endMeters.dx ** 2) + (endMeters.dy ** 2);

  if (segLenSq === 0) {
    return {
      distanceM: Math.hypot(pointMeters.dx, pointMeters.dy),
      projX: 0,
      projY: 0,
      cross: 0,
      start,
    };
  }

  let t = ((pointMeters.dx * endMeters.dx) + (pointMeters.dy * endMeters.dy)) / segLenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = t * endMeters.dx;
  const projY = t * endMeters.dy;
  const deltaX = pointMeters.dx - projX;
  const deltaY = pointMeters.dy - projY;

  return {
    distanceM: Math.hypot(deltaX, deltaY),
    projX,
    projY,
    cross: (endMeters.dx * pointMeters.dy) - (endMeters.dy * pointMeters.dx),
    start,
  };
}

function resolveFacingBearing(baseBearing, projection, origin, outwardReference) {
  const candidateA = normalizeDegrees(baseBearing + 90);
  const candidateB = normalizeDegrees(baseBearing - 90);

  if (outwardReference) {
    const referenceMeters = latLngToMeters(origin.lat, origin.lng, outwardReference.lat, outwardReference.lng);
    const fromProjection = {
      dx: referenceMeters.dx - projection.projX,
      dy: referenceMeters.dy - projection.projY,
    };
    const dotA = dotBearing(candidateA, fromProjection);
    const dotB = dotBearing(candidateB, fromProjection);
    return dotA <= dotB ? candidateA : candidateB;
  }

  return projection.cross <= 0 ? candidateA : candidateB;
}

function getBearingVector(bearing) {
  const radians = normalizeDegrees(bearing) * Math.PI / 180;
  return {
    dx: Math.sin(radians),
    dy: Math.cos(radians),
  };
}

function dotBearing(bearing, vector) {
  const axis = getBearingVector(bearing);
  return (axis.dx * vector.dx) + (axis.dy * vector.dy);
}

function getPointCentroid(points) {
  const total = points.reduce((acc, point) => ({
    lat: acc.lat + point.lat,
    lng: acc.lng + point.lng,
  }), { lat: 0, lng: 0 });

  return {
    lat: total.lat / points.length,
    lng: total.lng / points.length,
  };
}

function getEffectiveSelectedSpaceId() {
  return selectedSpaceId && drawnSpaces.some((space) => space.id === selectedSpaceId)
    ? selectedSpaceId
    : (drawnSpaces[0]?.id || null);
}

export function cleanup() {
  cancelScheduledHeatmapRefresh();

  document.removeEventListener('keydown', handleEscapeKey);

  if (map) {
    map.remove();
    map = null;
  }

  markers = [];
  pendingPlacement = null;
  fenceStartPoint = null;
  activeMode = 'space';
  activeObstacleTool = 'fence';
  selectedSpaceId = null;
  initialSceneReady = false;
  heatmapIdleHandle = null;
}
