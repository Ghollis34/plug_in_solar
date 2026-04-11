import { setState } from '../utils/state.js';
import { degreesToCompass, getBearingBetweenPoints, getRectangleRing, latLngToMeters, metersToLatLng, normalizeDegrees } from '../utils/geometry.js';
import { getMapLightFromSun, samplePlacementHeatmap } from '../utils/sun.js';
import { escapeHtml } from '../utils/security.js';
import { getSpaceTypeInfo, OBSTACLE_TOOLS, SPACE_TYPES } from '../utils/site-config.js';
import { createMapStepSession } from '../utils/map-step-session.js';
import { renderObstacleList } from '../utils/obstacle-list.js';
import { rotateShedById } from '../utils/site-obstacle-state.js';
import { getShedRotationValue, setShedRotationValue, syncShedRotationUI } from '../utils/shed-rotation.js';
import { getAnnualSolarRecommendation } from '../utils/solar-placement.js';
import {
  getBuildingsState,
  getLocationState,
  getObstaclesState,
  getPrimaryBuilding,
  getPrimaryBuildingCentroid,
  getPrimaryBuildingFootprint,
  getSelectedSpaceIdState,
  getSpacesState,
} from '../utils/site-state.js';

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
let heatmapRefineHandle = null;
let heatmapRefineIdleHandle = null;
let heatmapRenderNonce = 0;
let initialSceneReady = false;
let mapRuntime = null;

const mapSession = createMapStepSession();

const SURFACE_SNAP_DISTANCE_M = 6;
const WALL_SNAP_DISTANCE_M = 5;
const PANEL_SNAP_OFFSET_M = 0.8;
const HEATMAP_RADIUS_M = 16;
const HEATMAP_PRIMARY_STEP_M = 2.5;
const HEATMAP_REFINED_STEP_M = 2.0;

export function render() {
  const obstacleCount = getObstaclesState().length;

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

          <div class="card-flat card-flat-subtle task-guide-card">
            <div class="task-guide-header">
              <div class="task-guide-title">How To Use This Step</div>
              <div class="task-guide-summary" id="placement-guide-summary">
                Start with the greener parts of the map, then drop two or three likely panel spots to compare.
              </div>
            </div>
            <div class="task-guide-list">
              <div class="task-guide-item">
                <span class="task-guide-index">1</span>
                <div class="task-guide-copy">
                  <strong>Look for the greenest areas</strong>
                  <span>Greener cells usually have the strongest year-round direct sun.</span>
                </div>
                <span class="task-guide-status" id="placement-guide-heatmap-status">Loading</span>
              </div>
              <div class="task-guide-item">
                <span class="task-guide-index">2</span>
                <div class="task-guide-copy">
                  <strong>Pick a mounting surface</strong>
                  <span>Choose the kind of surface the panel may sit on, such as fence, wall, or ground.</span>
                </div>
                <span class="task-guide-status" id="placement-guide-surface-status">Ground</span>
              </div>
              <div class="task-guide-item">
                <span class="task-guide-index">3</span>
                <div class="task-guide-copy">
                  <strong>Add likely panel spots</strong>
                  <span>Place at least one marker. Two or three spots gives the comparison step more to work with.</span>
                </div>
                <span class="task-guide-status" id="placement-guide-spots-status">Add 1+</span>
              </div>
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Surface type</label>
            <div class="space-type-grid">
              ${SPACE_TYPES.map((type) => `
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
            <div class="analysis-note" id="tilt-note" style="margin-top: 8px;">
              We prefill the annual-best tilt for the selected site and keep it editable for fixed hardware.
            </div>
          </div>

          <button class="btn btn-primary w-full mb-md" id="btn-add-space">
            📌 Add Ground / Garden Spot
          </button>

          <div class="analysis-note mb-md" id="placement-status">
            Start with the greenest area, then add one or more likely panel spots. Go back to Site Setup if you need to change fences, sheds, or trees.
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
          Continue To Shadows →
        </button>
      </div>
    </div>
  `;
}

export function init() {
  const location = getLocationState();
  if (!location) return;

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

  const token = mapSession.beginRun();
  showPlacementMapLoading('Loading placement map…');

  mapSession.ensureRuntime(token)
    .then((runtime) => {
      if (!runtime) return null;
      mapRuntime = runtime;

      drawnSpaces = [...getSpacesState()];
      drawnObstacles = mapRuntime.normalizeObstacles(getObstaclesState());
      selectedSpaceId = getSelectedSpaceIdState() || drawnSpaces[0]?.id || null;
      spaceCounter = drawnSpaces.length;
      obstacleCounter = drawnObstacles.length;
      initialSceneReady = false;

      initControls();
      updateObstaclesList();
      updateSpacesList();
      updateNextButton();
      updatePlacementStatus('Start with the greenest area, then add one or more likely panel spots. Go back to Site Setup if you need to change fences, sheds, or trees.');
      updatePlacementGuide();
      return initMap(location, token);
    })
    .then((createdMap) => {
      if (!createdMap || !mapSession.isCurrent(token)) return;
      map = createdMap;
      bindMapInteractions();
    })
    .catch((error) => {
      if (!mapSession.isCurrent(token)) return;
      console.error('Failed to load placement map:', error);
      showPlacementMapLoading('Failed to load placement map. Refresh or try again.');
    });
}

function initMap(location, token) {
  const mapCenter = getPlacementCenter(location);
  return mapSession.createMap(token, {
    container: 'spaces-map',
    center: [mapCenter.lng, mapCenter.lat],
    zoom: 18.6,
    pitch: 55,
    bearing: -24,
    onLoad: (mapInstance) => {
      map = mapInstance;
      if (!mapSession.isCurrent(token)) {
        return;
      }

      showPlacementMapLoading('Positioning map…');
      drawHousePreview();
      refreshObstaclesAfterSettledPaint();
      drawnSpaces.forEach((space) => addMarkerToMap(space));
      applyPlacementSceneLighting();

      return new Promise((resolve) => {
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
          resolve();
        });
      });
    },
  });
}

function bindMapInteractions() {
  if (!map) return;

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
      updatePlacementRecommendations(button.dataset.type);
      updatePlacementGuide();
    });
  });

  const orientSlider = document.getElementById('orientation-slider');
  orientSlider?.addEventListener('input', () => {
    syncOrientationValue(parseInt(orientSlider.value, 10));
  });

  const tiltSlider = document.getElementById('tilt-slider');
  tiltSlider?.addEventListener('input', () => {
    syncTiltValue(parseInt(tiltSlider.value, 10));
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
  updatePlacementRecommendations(document.querySelector('.space-type-btn.active')?.dataset.type || 'ground');
  updatePlacementGuide();
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
  activeObstacleTool = OBSTACLE_TOOLS.find((entry) => entry.id === tool)?.id || 'fence';
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
  const compareHint = drawnSpaces.length < 2
    ? ' Add another likely spot if you want us to compare options.'
    : '';
  updatePlacementStatus(space?.alignmentHint ? `${space.alignmentHint}.${compareHint}` : `Panel spot added.${compareHint}`);
}

function addSpace(lat, lng) {
  spaceCounter += 1;
  const activeType = document.querySelector('.space-type-btn.active');
  const typeId = activeType?.dataset.type || 'ground';
  const typeInfo = getSpaceTypeInfo(typeId);
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
  const el = mapRuntime.createPanelMarkerElement(space, {
    onClick: (event) => {
      event.stopPropagation();
      selectSpace(space.id);
    },
  });

  const marker = new mapRuntime.maplibregl.Marker({
    element: el,
    anchor: 'center',
    pitchAlignment: 'map',
    rotationAlignment: 'map',
  })
    .setLngLat([space.centerLng, space.centerLat])
    .setPopup(new mapRuntime.maplibregl.Popup({ offset: 25 }).setDOMContent(createSpacePopupContent(space)))
    .addTo(map);

  markers.push({ id: space.id, marker, element: el });
  applyMarkerSelectionStyles();
}

function createSpacePopupContent(space) {
  const root = document.createElement('div');

  const title = document.createElement('strong');
  title.textContent = space.name || 'Panel location';

  const meta = document.createElement('span');
  meta.style.fontSize = '0.8rem';
  meta.style.color = '#94A3B8';
  meta.textContent = `${space.orientationLabel || 'Facing set'} · ${space.tilt ?? 35}° tilt${space.alignmentHint ? ` · ${space.alignmentHint}` : ''}`;

  root.append(title, document.createElement('br'), meta);
  return root;
}

function refreshObstacles() {
  return mapRuntime.drawObstacles(map, drawnObstacles);
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
  refreshObstacles();
  queueHeatmapRefresh(options);
}

function queueHeatmapRefresh(options = {}) {
  cancelScheduledHeatmapRefresh();
  heatmapRenderNonce += 1;
  const renderNonce = heatmapRenderNonce;
  setHeatmapStatus('Rendering suitability surface…');

  const delay = options.immediate ? 40 : 170;
  heatmapRefreshHandle = window.setTimeout(() => {
    const runRender = () => {
      heatmapIdleHandle = null;
      heatmapRefreshHandle = null;

      try {
        if (!mapRuntime.hasUsableMapStyle(map)) {
          hidePlacementMapLoading();
          setHeatmapStatus('Suitability surface unavailable.');
          return;
        }

        const center = getHeatmapCenter();
        const buildings = getPlacementHeatmapBuildings(center);
        const featureCollection = samplePlacementHeatmap(center.lat, center.lng, buildings, drawnObstacles, {
          radiusM: HEATMAP_RADIUS_M,
          stepM: options.stepM ?? HEATMAP_PRIMARY_STEP_M,
          fastMode: options.fastMode === true,
        });
        mapRuntime.drawSuitabilityHeatmap(map, featureCollection);
        refreshObstacles();
        initialSceneReady = true;
        setHeatmapStatus('Suitability surface ready.');
        refreshPanelMarkers();

        if (shouldRefineHeatmap(options)) {
          scheduleHeatmapRefinement(renderNonce);
        }
      } catch (error) {
        console.error('Failed to render placement heatmap:', error);
        initialSceneReady = false;
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

function shouldRefineHeatmap(options = {}) {
  return options.fastMode === true && options.refine !== false;
}

function scheduleHeatmapRefinement(renderNonce) {
  const runRefinement = () => {
    heatmapRefineHandle = null;
    heatmapRefineIdleHandle = null;

    if (renderNonce !== heatmapRenderNonce || !mapRuntime.hasUsableMapStyle(map)) {
      return;
    }

    if (typeof map.isMoving === 'function' && map.isMoving()) {
      scheduleHeatmapRefinement(renderNonce);
      return;
    }

    try {
      const center = getHeatmapCenter();
      const buildings = getPlacementHeatmapBuildings(center);
      const featureCollection = samplePlacementHeatmap(center.lat, center.lng, buildings, drawnObstacles, {
        radiusM: HEATMAP_RADIUS_M,
        stepM: HEATMAP_REFINED_STEP_M,
        fastMode: true,
      });

      if (renderNonce !== heatmapRenderNonce || !mapRuntime.hasUsableMapStyle(map)) {
        return;
      }

      mapRuntime.drawSuitabilityHeatmap(map, featureCollection);
      refreshObstacles();
      refreshPanelMarkers();
    } catch (error) {
      console.error('Failed to refine placement heatmap:', error);
    }
  };

  if (typeof window.requestIdleCallback === 'function') {
    heatmapRefineIdleHandle = window.requestIdleCallback(runRefinement, { timeout: 900 });
    return;
  }

  heatmapRefineHandle = window.setTimeout(runRefinement, 260);
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
    mapRuntime.updatePanelMarkerElement(entry.element, space, {
      selected: isSelected,
      rotation: getMarkerScreenRotation(space),
    });
  });
}

function updateSpacesList() {
  const listEl = document.getElementById('spaces-list');
  if (!listEl) return;

  if (drawnSpaces.length === 0) {
    listEl.innerHTML = `
      <div class="card-flat card-flat-subtle" style="padding: 12px; margin-top: 12px;">
        <div style="font-weight: 600; margin-bottom: 4px;">No panel spots added yet</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary);">
          Pick a surface type, click the button above, then click the map where a panel could realistically go.
        </div>
      </div>
    `;
    updatePlacementGuide();
    return;
  }

  listEl.innerHTML = `
    <h4 style="margin-bottom: 10px; font-size: 0.9rem; color: var(--text-secondary);">
      Added Locations (${drawnSpaces.length})
    </h4>
    ${drawnSpaces.map((space) => `
      <div class="card-flat compact-row ${space.id === selectedSpaceId ? 'analysis-card-best' : ''}">
        <div>
          <span>${escapeHtml(space.typeIcon)}</span>
          <strong style="font-size: 0.85rem;">${escapeHtml(space.name)}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            ${escapeHtml(space.orientationLabel)} · ${escapeHtml(space.tilt)}° tilt${space.alignmentHint ? ` · ${escapeHtml(space.alignmentHint)}` : ''}
          </div>
        </div>
        <div class="badge-row">
          <button class="btn btn-sm btn-outline select-space-btn" data-id="${escapeHtml(space.id)}" style="padding: 4px 10px; font-size: 0.75rem;">
            ${space.id === selectedSpaceId ? 'Selected' : 'Use This'}
          </button>
          <button class="btn btn-sm btn-secondary remove-space-btn" data-id="${escapeHtml(space.id)}" style="padding: 4px 10px; font-size: 0.75rem;">✕</button>
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

  updatePlacementGuide();
}

function updateObstaclesList() {
  const listEl = document.getElementById('obstacles-list');
  if (!listEl) return;

  renderObstacleList(listEl, {
    obstacles: drawnObstacles,
    heading: drawnObstacles.length ? `Site Obstacles (${drawnObstacles.length})` : null,
    note: drawnObstacles.length
      ? 'These are the fences, sheds, and trees from Site Setup. They are read-only here and used for placement snapping and shadow scoring.'
      : null,
    emptyTitle: 'Site obstacles',
    emptyMessage: 'No fences, sheds, or trees have been carried into this step yet. That is fine if nothing nearby affects shade, or go back to Site Setup to add them.',
    onRotate: rotateShed,
    onRemove: (id) => {
      drawnObstacles = drawnObstacles.filter((obstacle) => obstacle.id !== id);
      refreshObstacles();
      queueHeatmapRefresh();
      updateObstaclesList();
    },
  });
}

function setShedRotation(value) {
  setShedRotationValue(value);
}

function getShedRotation() {
  return getShedRotationValue();
}

function updateShedRotationUI() {
  syncShedRotationUI();
}

function rotateShed(obstacleId, deltaDeg) {
  drawnObstacles = rotateShedById(drawnObstacles, obstacleId, deltaDeg);
  refreshObstacles();
  queueHeatmapRefresh();
  updateObstaclesList();
}

function updateNextButton() {
  const btn = document.getElementById('btn-next-spaces');
  if (btn) {
    btn.disabled = drawnSpaces.length === 0;
  }

  updatePlacementGuide();
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
  document.body.classList.add('map-placement-banner-active');
}

function hidePlacementBanner() {
  const banner = document.getElementById('placement-banner');
  if (banner) banner.classList.add('hidden');
  document.body.classList.remove('map-placement-banner-active');
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

function updatePlacementRecommendations(typeId) {
  const recommendation = getPlacementRecommendation();
  applyPlacementRecommendationControls(recommendation);
  updateOrientationNote(typeId, recommendation);
  updateTiltNote(typeId, recommendation);
  updatePlacementActionLabel(typeId);
}

function getPlacementRecommendation() {
  return getAnnualSolarRecommendation(getLocationState()?.lat);
}

function applyPlacementRecommendationControls(recommendation) {
  const orientationSlider = document.getElementById('orientation-slider');
  const tiltSlider = document.getElementById('tilt-slider');

  if (orientationSlider) {
    orientationSlider.value = String(recommendation.orientation);
  }

  if (tiltSlider) {
    tiltSlider.value = String(recommendation.tilt);
  }

  syncOrientationValue(recommendation.orientation);
  syncTiltValue(recommendation.tilt);
}

function syncOrientationValue(value) {
  const orientValue = document.getElementById('orientation-value');
  if (!orientValue || !Number.isFinite(value)) return;
  orientValue.textContent = `${degreesToCompass(value, 'long')} (${value}°)`;
}

function syncTiltValue(value) {
  const tiltValue = document.getElementById('tilt-value');
  if (!tiltValue || !Number.isFinite(value)) return;
  tiltValue.textContent = `${value}°`;
}

function updatePlacementActionLabel(typeId) {
  const button = document.getElementById('btn-add-space');
  if (!button) return;

  const typeInfo = getSpaceTypeInfo(typeId);
  button.textContent = `📌 Add ${typeInfo.label} Spot`;
}

function updatePlacementGuide() {
  const summaryEl = document.getElementById('placement-guide-summary');
  const activeTypeId = getActiveSpaceTypeId();
  const activeType = getSpaceTypeInfo(activeTypeId);
  const spaceCount = drawnSpaces.length;

  if (summaryEl) {
    summaryEl.textContent = spaceCount > 0
      ? `${spaceCount} candidate spot${spaceCount === 1 ? '' : 's'} added. Continue or add more if you want a stronger comparison.`
      : 'Start with the greener parts of the map, then drop two or three likely panel spots to compare.';
  }

  setGuideStatus('placement-guide-heatmap-status', initialSceneReady ? 'Ready' : 'Loading', initialSceneReady);
  setGuideStatus('placement-guide-surface-status', activeType.label, Boolean(activeTypeId));
  setGuideStatus('placement-guide-spots-status', spaceCount > 0 ? `${spaceCount} added` : 'Add 1+', spaceCount > 0);
}

function getActiveSpaceTypeId() {
  return document.querySelector('.space-type-btn.active')?.dataset.type || 'ground';
}

function setGuideStatus(elementId, label, done = false) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.textContent = label;
  element.classList.toggle('is-done', done);
}

function updateOrientationNote(typeId, recommendation) {
  const noteEl = document.getElementById('orientation-note');
  if (!noteEl) return;

  if (typeId === 'fence') {
    noteEl.textContent = `Fence-mounted panels snap onto the nearest drawn fence and stay on your side of the boundary. If a snap fails, we fall back to ${degreesToCompass(recommendation.orientation, 'long')} (${recommendation.orientation}°).`;
    return;
  }

  if (typeId === 'wall') {
    noteEl.textContent = getPrimaryBuildingFootprint().length >= 3
      ? `Click near a house wall to snap the panel onto that wall. If a snap misses, the fallback facing is ${degreesToCompass(recommendation.orientation, 'long')} (${recommendation.orientation}°).`
      : `Set the house direction first if you want wall mounts to snap to the house outline. Until then, the fallback facing is ${degreesToCompass(recommendation.orientation, 'long')} (${recommendation.orientation}°).`;
    return;
  }

  noteEl.textContent = `Prefilled for this site: ${degreesToCompass(recommendation.orientation, 'long')} (${recommendation.orientation}°) for the strongest year-round exposure. You can still override it.`;
}

function updateTiltNote(typeId, recommendation) {
  const noteEl = document.getElementById('tilt-note');
  if (!noteEl) return;

  if (typeId === 'fence') {
    noteEl.textContent = `Annual tilt target here is about ${recommendation.tilt}°. Keep that if the fence bracket is adjustable; otherwise set it to match the fixed mount.`;
    return;
  }

  if (typeId === 'wall') {
    noteEl.textContent = `Annual tilt target here is about ${recommendation.tilt}°. Leave it if you are using an angled wall bracket, or adjust it for a more upright mount.`;
    return;
  }

  noteEl.textContent = `Prefilled to about ${recommendation.tilt}° from the site latitude for stronger year-round exposure.`;
}

function getNearestFenceAlignment(lat, lng) {
  const fences = drawnObstacles.filter((obstacle) => obstacle.type === 'fence' && obstacle.points?.length >= 2);
  if (!fences.length) return null;
  const userSideReference = getPrimaryBuildingCentroid();

  const scored = fences.map((fence) => {
    const start = fence.points[0];
    const end = fence.points[1];
    return getSurfaceAlignment(start, end, lat, lng, {
      hint: userSideReference ? 'Snapped to nearby fence on your side' : 'Snapped to nearby fence',
      offsetM: PANEL_SNAP_OFFSET_M,
      referencePoint: userSideReference,
      referenceMode: userSideReference ? 'toward' : 'auto',
      surfaceType: 'fence',
    });
  }).sort((a, b) => a.distanceM - b.distanceM);

  return scored[0]?.distanceM <= SURFACE_SNAP_DISTANCE_M ? scored[0] : null;
}

function drawHousePreview() {
  const userBuilding = getPrimaryBuilding();
  if (!userBuilding) return;
  mapRuntime.drawBuildingFootprintPreview(map, userBuilding);
}

function fitMapToPlacementSite(onComplete) {
  if (!mapRuntime.hasUsableMapStyle(map)) {
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
  const location = getLocationState();
  if (!mapRuntime.hasUsableMapStyle(map) || !location) return;

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
    : getPlacementCenter(getLocationState());
}

function getPlacementHeatmapBuildings(center) {
  const buildings = getBuildingsState();

  if (!map || typeof mapRuntime?.getShadeModelBuildings !== 'function') {
    return buildings;
  }

  return mapRuntime.getShadeModelBuildings(map, buildings, {
    center,
    radiusM: 120,
  });
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

  if (heatmapRefineHandle) {
    window.clearTimeout(heatmapRefineHandle);
    heatmapRefineHandle = null;
  }

  if (heatmapRefineIdleHandle && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(heatmapRefineIdleHandle);
    heatmapRefineIdleHandle = null;
  }
}

function setHeatmapStatus(message) {
  const statusEl = document.getElementById('heatmap-status');
  if (statusEl) {
    statusEl.textContent = message;
  }

  updatePlacementGuide();
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

  const centroid = getPrimaryBuildingCentroid();
  const scored = footprint.map((point, index) => {
    const next = footprint[(index + 1) % footprint.length];
    return getSurfaceAlignment(point, next, lat, lng, {
      hint: 'Snapped to house wall',
      offsetM: PANEL_SNAP_OFFSET_M,
      referencePoint: centroid,
      referenceMode: 'away',
      surfaceType: 'wall',
    });
  }).sort((a, b) => a.distanceM - b.distanceM);

  return scored[0]?.distanceM <= WALL_SNAP_DISTANCE_M ? scored[0] : null;
}

function getSurfaceAlignment(start, end, lat, lng, options = {}) {
  const projection = projectToSegmentMeters(lat, lng, start, end);
  const baseBearing = normalizeDegrees(Math.round(getBearingBetweenPoints(start.lat, start.lng, end.lat, end.lng)));
  const facing = normalizeDegrees(Math.round(resolveFacingBearing(baseBearing, projection, start, {
    referencePoint: options.referencePoint ?? options.outwardReference ?? null,
    referenceMode: options.referenceMode || 'away',
  })));
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

function resolveFacingBearing(baseBearing, projection, origin, options = {}) {
  const candidateA = normalizeDegrees(baseBearing + 90);
  const candidateB = normalizeDegrees(baseBearing - 90);
  const referencePoint = options.referencePoint || null;

  if (referencePoint) {
    const referenceMeters = latLngToMeters(origin.lat, origin.lng, referencePoint.lat, referencePoint.lng);
    const fromProjection = {
      dx: referenceMeters.dx - projection.projX,
      dy: referenceMeters.dy - projection.projY,
    };
    const dotA = dotBearing(candidateA, fromProjection);
    const dotB = dotBearing(candidateB, fromProjection);

    if (options.referenceMode === 'toward') {
      return dotA >= dotB ? candidateA : candidateB;
    }

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

function getEffectiveSelectedSpaceId() {
  return selectedSpaceId && drawnSpaces.some((space) => space.id === selectedSpaceId)
    ? selectedSpaceId
    : (drawnSpaces[0]?.id || null);
}

export function cleanup() {
  heatmapRenderNonce += 1;
  cancelScheduledHeatmapRefresh();
  document.body.classList.remove('map-placement-banner-active');

  document.removeEventListener('keydown', handleEscapeKey);

  mapSession.destroy();
  map = null;

  markers = [];
  pendingPlacement = null;
  fenceStartPoint = null;
  activeMode = 'space';
  activeObstacleTool = 'fence';
  selectedSpaceId = null;
  initialSceneReady = false;
  heatmapIdleHandle = null;
  heatmapRefineIdleHandle = null;
}
