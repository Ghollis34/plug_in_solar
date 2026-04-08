import { getState, setState } from '../utils/state.js';
import { degreesToCompass, latLngToMeters, metersToLatLng, normalizeDegrees } from '../utils/geometry.js';
import { FRONT_DOOR_OPTIONS, OBSTACLE_TOOLS, SHED_DIRECTION_OPTIONS } from '../utils/site-config.js';
import { loadMapRuntime } from '../utils/map-runtime.js';
import { renderObstacleList } from '../utils/obstacle-list.js';
import { getSelectedObstacleLabel, moveObstacleById, rotateShedById } from '../utils/site-obstacle-state.js';
import { getShedRotationValue, setShedRotationValue, syncShedRotationUI } from '../utils/shed-rotation.js';

let map = null;
let mapLoaded = false;
let draftCenter = null;
let draftFootprint = null;
let draftFrontDoorFacing = null;
let nearbyBuildings = [];
let drawnObstacles = [];
let obstacleCounter = 0;
let selectedObstacleId = null;
let activeObstacleTool = 'fence';
let pendingPlacement = null;
let fenceStartPoint = null;
let mapInitToken = 0;
let captureBuildingAtLocation = null;
let captureNearbyBuildings = null;
let createStepMap = null;
let drawBuildingFootprintPreview = null;
let drawObstacles = null;
let normalizeObstacles = null;

const DEFAULT_WIDTH_M = 5;
const DEFAULT_DEPTH_M = 9;
const DEFAULT_HEIGHT_M = 7.2;
const NUDGE_STEP_M = 1.5;
const OBSTACLE_NUDGE_STEP_M = 0.5;
export function render() {
  const building = (getState('buildings') || [])[0] || {};
  const facing = building.frontDoorFacing;
  const facingValue = facing ?? 180;
  const obstacleCount = (getState('obstacles') || []).length;

  return `
    <div class="step-page step-page-map">
      <div class="step-header">
        <div class="section-kicker">Step 2 · Site Setup</div>
        <h2 class="step-title">Confirm Property & Site Obstacles</h2>
        <p class="step-subtitle">Lock the house outline to the right building, then add any fences, sheds, or trees that could affect panel placement.</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="buildings-map"></div>
        <div class="map-loading-overlay" id="buildings-map-loading">
          <div class="loading-spinner"></div>
          <div id="buildings-map-loading-text">Loading site map…</div>
        </div>
        <div class="map-overlay-bottom map-overlay-bottom-legend">
          <div class="map-legend-title">Site setup</div>
          <div class="map-legend-copy">Match the outlined property to your house, then add the fixed site obstacles around it. These carry forward into panel placement and shadow analysis.</div>
        </div>

        <div class="map-placement-banner hidden" id="site-setup-banner">
          <span id="site-setup-banner-text">Click the map to place</span>
          <button class="btn btn-sm btn-secondary" id="btn-cancel-site-placement" style="padding: 4px 12px; font-size: 0.75rem;">✕ Cancel</button>
        </div>

        <div class="map-overlay-panel map-overlay-panel-building">
          <div class="map-panel-header">
            <div>
              <div class="map-panel-kicker">Site Setup</div>
              <h3 class="map-panel-title">Property Outline & Obstacles</h3>
            </div>
            <div class="map-panel-pill">${obstacleCount} saved</div>
          </div>

          <div class="metric-glass-card metric-glass-card-compact">
            <div>
              <div class="metric-glass-label">Selected property</div>
              <div class="metric-glass-value">Outline locked</div>
            </div>
            <div class="metric-glass-note" id="nearby-buildings-note">Checking neighbouring buildings nearby…</div>
          </div>

          <div class="form-group mb-md">
            <div class="flex justify-between items-center" style="margin-bottom: 8px;">
              <label class="form-label">Property facing</label>
              <button class="btn btn-sm btn-secondary" id="btn-clear-direction" type="button" style="padding: 6px 10px; font-size: 0.75rem;">
                Clear
              </button>
            </div>

            <div class="direction-grid" id="front-door-grid">
              ${FRONT_DOOR_OPTIONS.map((option) => `
                <button class="direction-chip ${facing === option.deg ? 'active' : ''}" data-facing="${option.deg}" type="button">
                  ${option.label}
                </button>
              `).join('')}
            </div>

            <div class="flex items-center gap-md" style="margin-top: 12px;">
              <input type="range" class="range-slider" id="front-door-slider" min="0" max="355" step="5" value="${facingValue}" />
              <span id="front-door-value" style="min-width: 118px; text-align: right; font-weight: 600;">
                ${facing == null ? 'Unset' : `${degreesToCompass(facing, 'long')} (${facing}°)`}
              </span>
            </div>

            <div class="analysis-note" id="direction-note" style="margin-top: 10px;">
              ${facing == null
                ? 'Only needed if the map footprint is weak or missing. Otherwise we will use the detected building outline directly.'
                : `Reference direction set to ${degreesToCompass(facing, 'long')}. We will use it as a fallback for wall snaps if the map outline is incomplete.`}
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Property position</label>
            <div class="nudge-grid">
              <button class="direction-chip" data-nudge="north" type="button">↑</button>
              <button class="direction-chip" data-nudge="west" type="button">←</button>
              <button class="direction-chip" data-nudge="reset" type="button">Reset</button>
              <button class="direction-chip" data-nudge="east" type="button">→</button>
              <button class="direction-chip" data-nudge="south" type="button">↓</button>
            </div>
            <div class="analysis-note" id="position-note" style="margin-top: 10px;">
              Start with the detected property, then nudge the outline if the footprint is slightly off.
            </div>
          </div>

          <div class="card-flat card-flat-subtle" style="padding: 12px; margin-bottom: 12px;">
            <div style="font-weight: 600; margin-bottom: 4px;">What to add here</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">
              Draw fences, sheds, and trees that are fixed parts of the site. The next step is only for candidate panel locations.
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Selected obstacle position</label>
            <div class="nudge-grid">
              <button class="direction-chip" data-obstacle-nudge="north" type="button">↑</button>
              <button class="direction-chip" data-obstacle-nudge="west" type="button">←</button>
              <button class="direction-chip" data-obstacle-nudge="clear" type="button">Done</button>
              <button class="direction-chip" data-obstacle-nudge="east" type="button">→</button>
              <button class="direction-chip" data-obstacle-nudge="south" type="button">↓</button>
            </div>
            <div class="analysis-note" id="obstacle-position-note" style="margin-top: 10px;">
              Select an obstacle below, then nudge it around the map.
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Obstacle type</label>
            <div class="direction-grid">
              ${OBSTACLE_TOOLS.map((tool) => `
                <button class="direction-chip ${tool.id === activeObstacleTool ? 'active' : ''}" data-obstacle-tool="${tool.id}">
                  ${tool.icon} ${tool.label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="obstacle-form ${activeObstacleTool === 'fence' ? '' : 'hidden'}" data-config-tool="fence">
            <div class="form-group mb-md">
              <label class="form-label">Fence height (m)</label>
              <input type="number" class="form-input" id="fence-height" min="0.5" max="5" step="0.1" value="1.8" />
            </div>
          </div>

          <div class="obstacle-form hidden" data-config-tool="tree">
            <div class="form-group mb-md">
              <label class="form-label">Tree height (m)</label>
              <input type="number" class="form-input" id="tree-height" min="1" max="30" step="0.5" value="5" />
            </div>
            <div class="form-group mb-md">
              <label class="form-label">Canopy radius (m)</label>
              <input type="number" class="form-input" id="tree-radius" min="1" max="15" step="0.5" value="3" />
            </div>
          </div>

          <div class="obstacle-form hidden" data-config-tool="shed">
            <div class="form-group mb-md">
              <label class="form-label">Height (m)</label>
              <input type="number" class="form-input" id="shed-height" min="1" max="10" step="0.1" value="2.5" />
            </div>
            <div class="form-group mb-md">
              <label class="form-label">Width (m)</label>
              <input type="number" class="form-input" id="shed-width" min="1" max="20" step="0.5" value="3" />
            </div>
            <div class="form-group mb-md">
              <label class="form-label">Depth (m)</label>
              <input type="number" class="form-input" id="shed-depth" min="1" max="20" step="0.5" value="2" />
            </div>
            <div class="form-group mb-md">
              <label class="form-label">Front face direction</label>
              <div class="direction-grid">
                ${SHED_DIRECTION_OPTIONS.map((option) => `
                  <button class="direction-chip ${option.deg === 0 ? 'active' : ''}" data-shed-rotation="${option.deg}" type="button">
                    ${option.label}
                  </button>
                `).join('')}
              </div>
              <div class="flex items-center gap-md" style="margin-top: 12px;">
                <input type="range" class="range-slider" id="shed-rotation-slider" min="0" max="355" step="5" value="0" />
                <span id="shed-rotation-value" style="min-width: 112px; text-align: right; font-weight: 600;">North (0°)</span>
              </div>
              <div class="analysis-note" id="shed-rotation-note" style="margin-top: 10px;">
                Set the shed face direction before you place it on the map.
              </div>
            </div>
          </div>

          <button class="btn btn-primary w-full mb-md" id="btn-place-obstacle">
            🟧 Draw Fence
          </button>
          <button class="btn btn-secondary w-full mb-md hidden" id="btn-cancel-fence">
            ✕ Cancel Drawing
          </button>

          <div class="analysis-note mb-md" id="site-setup-status">
            Confirm the property outline, then add any fences, sheds, or trees that could affect shading.
          </div>

          <div id="obstacles-list"></div>
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-buildings">← Back</button>
        <button class="btn btn-primary" id="btn-next-buildings">Continue →</button>
      </div>
    </div>
  `;
}

export function init() {
  const location = getState('location');
  if (!location) return;

  document.getElementById('btn-back-buildings')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-buildings')?.addEventListener('click', () => {
    saveBuilding();
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });

  const token = ++mapInitToken;
  showSiteMapLoading('Loading site map…');

  ensureMapRuntime()
    .then(() => {
      if (token !== mapInitToken) return;

      const building = (getState('buildings') || [])[0] || {};
      draftCenter = {
        lat: Number.isFinite(building.lat) ? building.lat : location.lat,
        lng: Number.isFinite(building.lng) ? building.lng : location.lng,
      };
      draftFootprint = building.footprint || null;
      draftFrontDoorFacing = Number.isFinite(building.frontDoorFacing) ? building.frontDoorFacing : null;
      drawnObstacles = normalizeObstacles(getState('obstacles') || []);
      obstacleCounter = drawnObstacles.length;
      selectedObstacleId = null;

      return initMap(location, token);
    })
    .then(() => {
      if (token !== mapInitToken) return;
      initControls();
      updateDirectionUI();
      updatePositionNote();
      updateObstaclePositionNote();
      updateObstaclesList();
      setActiveObstacleTool(activeObstacleTool);
    })
    .catch((error) => {
      if (token !== mapInitToken) return;
      console.error('Failed to load site setup map:', error);
      showSiteMapLoading('Failed to load site map. Refresh or try again.');
    });
}

function ensureMapRuntime() {
  if (createStepMap && normalizeObstacles) {
    return Promise.resolve();
  }

  return loadMapRuntime().then((runtime) => {
    captureBuildingAtLocation = runtime.captureBuildingAtLocation;
    captureNearbyBuildings = runtime.captureNearbyBuildings;
    createStepMap = runtime.createStepMap;
    drawBuildingFootprintPreview = runtime.drawBuildingFootprintPreview;
    drawObstacles = runtime.drawObstacles;
    normalizeObstacles = runtime.normalizeObstacles;
  });
}

function initMap(location, token) {
  const initialCenter = draftCenter || location;
  return new Promise((resolve) => {
    map = createStepMap({
      container: 'buildings-map',
      center: [initialCenter.lng, initialCenter.lat],
      zoom: 18.2,
      pitch: 56,
      bearing: -18,
      onLoad: () => {
        mapLoaded = true;
        refreshObstaclesAfterSettledPaint();
        map.once('idle', () => {
          focusMapOnDetectedBuilding(location);
          if (token === mapInitToken) {
            hideSiteMapLoading();
          }
          resolve();
        });
      },
    });

    map.on('click', (event) => {
      handleMapClick(event.lngLat.lat, event.lngLat.lng);
    });
  });
}

function initControls() {
  document.querySelectorAll('.direction-chip[data-facing]').forEach((button) => {
    button.addEventListener('click', () => {
      const facing = parseInt(button.dataset.facing || '', 10);
      setFrontDoorFacing(Number.isFinite(facing) ? facing : null);
    });
  });

  document.getElementById('front-door-slider')?.addEventListener('input', (event) => {
    const value = parseInt(event.target.value, 10);
    setFrontDoorFacing(Number.isFinite(value) ? value : null);
  });

  document.getElementById('btn-clear-direction')?.addEventListener('click', () => {
    draftFrontDoorFacing = null;
    updateDirectionUI();
    updateDirectionPreview();
  });

  document.querySelectorAll('[data-nudge]').forEach((button) => {
    button.addEventListener('click', () => {
      nudgeBuilding(button.dataset.nudge);
    });
  });

  document.querySelectorAll('[data-obstacle-nudge]').forEach((button) => {
    button.addEventListener('click', () => {
      nudgeSelectedObstacle(button.dataset.obstacleNudge);
    });
  });

  document.querySelectorAll('[data-obstacle-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveObstacleTool(button.dataset.obstacleTool);
    });
  });

  document.querySelectorAll('[data-shed-rotation]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = parseInt(button.dataset.shedRotation || '', 10);
      setShedRotation(Number.isFinite(value) ? value : 0);
    });
  });

  document.getElementById('shed-rotation-slider')?.addEventListener('input', (event) => {
    const value = parseInt(event.target.value, 10);
    setShedRotation(Number.isFinite(value) ? value : 0);
  });

  document.getElementById('btn-place-obstacle')?.addEventListener('click', () => {
    setPendingPlacement(activeObstacleTool);
  });

  document.getElementById('btn-cancel-fence')?.addEventListener('click', () => {
    cancelPlacement();
    updateSetupStatus('Drawing cancelled.');
  });

  document.getElementById('btn-cancel-site-placement')?.addEventListener('click', () => {
    cancelPlacement();
    updateSetupStatus('Placement cancelled.');
  });

  document.addEventListener('keydown', handleEscapeKey);
  updateShedRotationUI();
}

function setFrontDoorFacing(value) {
  draftFrontDoorFacing = value;
  updateDirectionUI();
  updateDirectionPreview();
}

function nudgeBuilding(direction) {
  const location = getState('location');
  if (!location || !draftCenter) return;

  if (direction === 'reset') {
    draftCenter = { lat: location.lat, lng: location.lng };
    draftFootprint = null;
    focusMapOnDetectedBuilding(location);
    return;
  } else {
    let dx = 0;
    let dy = 0;

    if (direction === 'north') dy = NUDGE_STEP_M;
    if (direction === 'south') dy = -NUDGE_STEP_M;
    if (direction === 'east') dx = NUDGE_STEP_M;
    if (direction === 'west') dx = -NUDGE_STEP_M;

    draftCenter = metersToLatLng(draftCenter.lat, draftCenter.lng, dx, dy);
    if (draftFootprint?.length) {
      draftFootprint = draftFootprint.map((point) => metersToLatLng(point.lat, point.lng, dx, dy));
    }
  }

  updatePositionNote();
  updateDirectionPreview();
}

function updateDirectionUI() {
  const slider = document.getElementById('front-door-slider');
  const valueEl = document.getElementById('front-door-value');
  const noteEl = document.getElementById('direction-note');

  if (slider && draftFrontDoorFacing != null) {
    slider.value = String(draftFrontDoorFacing);
  }

  document.querySelectorAll('.direction-chip[data-facing]').forEach((chip) => {
    chip.classList.toggle('active', parseInt(chip.dataset.facing || '', 10) === draftFrontDoorFacing);
  });

  if (valueEl) {
    valueEl.textContent = draftFrontDoorFacing == null
      ? 'Unset'
      : `${degreesToCompass(draftFrontDoorFacing, 'long')} (${draftFrontDoorFacing}°)`;
  }

  if (noteEl) {
    noteEl.textContent = draftFrontDoorFacing == null
      ? 'Only needed if the map footprint is weak or missing. Otherwise we will use the detected building outline directly.'
      : `Reference direction set to ${degreesToCompass(draftFrontDoorFacing, 'long')}. We will use it as a fallback for wall snaps if the map outline is incomplete.`;
  }
}

function updatePositionNote() {
  const location = getState('location');
  const noteEl = document.getElementById('position-note');
  if (!location || !noteEl || !draftCenter) return;

  const offset = latLngToMeters(location.lat, location.lng, draftCenter.lat, draftCenter.lng);
  const eastWest = offset.dx > 0 ? 'east' : 'west';
  const northSouth = offset.dy > 0 ? 'north' : 'south';
  const eastWestMeters = Math.abs(offset.dx).toFixed(1);
  const northSouthMeters = Math.abs(offset.dy).toFixed(1);

  if (eastWestMeters === '0.0' && northSouthMeters === '0.0') {
    noteEl.textContent = 'Outline is centred on the detected property.';
    return;
  }

  noteEl.textContent = `Outline offset: ${northSouthMeters}m ${northSouth}, ${eastWestMeters}m ${eastWest}.`;
}

function updateDirectionPreview() {
  if (!map || !mapLoaded || !map.isStyleLoaded() || !draftCenter) return;

  drawBuildingFootprintPreview(map, {
    lat: draftCenter.lat,
    lng: draftCenter.lng,
    widthM: DEFAULT_WIDTH_M,
    depthM: DEFAULT_DEPTH_M,
    frontDoorFacing: draftFrontDoorFacing,
    footprint: draftFootprint,
  });
}

function focusMapOnDetectedBuilding(location) {
  if (!map || !draftCenter) return;

  const detectedBuilding = captureBuildingAtLocation(map, draftCenter, { searchRadiusM: 32 });
  const targetCenter = detectedBuilding
    ? { lat: detectedBuilding.lat, lng: detectedBuilding.lng }
    : draftCenter;

  draftCenter = targetCenter;
  draftFootprint = detectedBuilding?.footprint || draftFootprint;

  const finalizeFocus = () => {
    updatePositionNote();
    updateDirectionPreview();
    captureNeighborBuildings();
    refreshObstaclesAfterSettledPaint();
  };

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
    finalizeFocus();
  };
  const handleMoveEnd = () => {
    finish();
  };

  if (detectedBuilding?.footprint?.length) {
    const bounds = getFootprintBounds(detectedBuilding.footprint);
    if (bounds) {
      map.on('moveend', handleMoveEnd);
      fallbackTimer = window.setTimeout(finish, 1100);
      try {
        map.fitBounds(bounds, {
          padding: { top: 88, right: 92, bottom: 88, left: 470 },
          maxZoom: 19.8,
          bearing: -18,
          pitch: 58,
          duration: 900,
          essential: true,
        });
      } catch (error) {
        finish();
      }
      return;
    }
  }

  map.on('moveend', handleMoveEnd);
  fallbackTimer = window.setTimeout(finish, 1050);
  try {
    map.easeTo({
      center: [targetCenter.lng, targetCenter.lat],
      zoom: 19.1,
      pitch: 58,
      bearing: -18,
      duration: 850,
      essential: true,
    });
  } catch (error) {
    finish();
  }
}

function captureNeighborBuildings() {
  if (!map || !draftCenter) return;

  const detectedBuilding = captureBuildingAtLocation(map, draftCenter, { searchRadiusM: 28 });
  nearbyBuildings = captureNearbyBuildings(map, draftCenter, {
    radiusM: 100,
    excludeContainingCenter: !detectedBuilding?.footprint?.length,
    excludeFootprint: detectedBuilding?.footprint?.length
      ? detectedBuilding.footprint.map(({ lat, lng }) => [lng, lat])
      : null,
  });

  const noteEl = document.getElementById('nearby-buildings-note');
  if (noteEl) {
    noteEl.textContent = nearbyBuildings.length > 0
      ? `${nearbyBuildings.length} neighbouring buildings detected within roughly 100m and included in the shade model.`
      : 'No neighbouring buildings were detected in the current view, so only your property and manual obstacles will be used.';
  }
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

  if (mode === 'tree') {
    showPlacementBanner('🌳 Click the map to place the tree');
    updateSetupStatus('Click on the map to place the tree marker.');
  } else if (mode === 'shed') {
    showPlacementBanner('⬜ Click the map to place the shed centre');
    updateSetupStatus('Click on the map to place the shed footprint centre.');
  } else {
    showPlacementBanner('🟧 Click the fence start point');
    updateSetupStatus('Click the fence start point, then click the fence end point.');
  }

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
  if (!pendingPlacement) return;

  if (pendingPlacement === 'tree') {
    addTree(lat, lng);
    cancelPlacement();
    updateSetupStatus('Tree added.');
    return;
  }

  if (pendingPlacement === 'shed') {
    addShed(lat, lng);
    cancelPlacement();
    updateSetupStatus('Shed footprint added.');
    return;
  }

  if (!fenceStartPoint) {
    fenceStartPoint = { lat, lng };
    updateSetupStatus('Fence start locked. Click the second point to finish the line.');
    showPlacementBanner('🟧 Click the fence end point (Esc to cancel)');
    updateCancelFenceButton();
    return;
  }

  addFence(fenceStartPoint, { lat, lng });
  cancelPlacement();
  updateSetupStatus('Fence added.');
}

function addFence(startPoint, endPoint) {
  obstacleCounter += 1;
  const obstacle = {
    id: `obstacle-${obstacleCounter}`,
    type: 'fence',
    points: [startPoint, endPoint],
    heightM: parseFloat(document.getElementById('fence-height')?.value || 1.8),
  };
  drawnObstacles.push(obstacle);
  selectedObstacleId = obstacle.id;
  refreshObstacles();
  updateObstaclePositionNote();
  updateObstaclesList();
}

function addTree(lat, lng) {
  obstacleCounter += 1;
  const obstacle = {
    id: `obstacle-${obstacleCounter}`,
    type: 'tree',
    lat,
    lng,
    heightM: parseFloat(document.getElementById('tree-height')?.value || 5),
    canopyRadiusM: parseFloat(document.getElementById('tree-radius')?.value || 3),
  };
  drawnObstacles.push(obstacle);
  selectedObstacleId = obstacle.id;
  refreshObstacles();
  updateObstaclePositionNote();
  updateObstaclesList();
}

function addShed(lat, lng) {
  obstacleCounter += 1;
  const obstacle = {
    id: `obstacle-${obstacleCounter}`,
    type: 'shed',
    lat,
    lng,
    heightM: parseFloat(document.getElementById('shed-height')?.value || 2.5),
    widthM: parseFloat(document.getElementById('shed-width')?.value || 3),
    depthM: parseFloat(document.getElementById('shed-depth')?.value || 2),
    rotationDeg: getShedRotation(),
  };
  drawnObstacles.push(obstacle);
  selectedObstacleId = obstacle.id;
  refreshObstacles();
  updateObstaclePositionNote();
  updateObstaclesList();
}

function refreshObstacles() {
  if (map?.isStyleLoaded()) {
    drawObstacles(map, drawnObstacles);
  }
}

function refreshObstaclesDeferred() {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        refreshObstacles();
      });
    });
    return;
  }

  window.setTimeout(() => {
    refreshObstacles();
  }, 0);
}

function refreshObstaclesAfterSettledPaint() {
  if (!map) return;

  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    refreshObstaclesDeferred();
  };

  refreshObstacles();

  if (typeof map.once === 'function') {
    map.once('idle', finish);
    window.setTimeout(finish, 180);
    return;
  }

  finish();
}

function updateObstaclesList() {
  const listEl = document.getElementById('obstacles-list');
  if (!listEl) return;

  renderObstacleList(listEl, {
    obstacles: drawnObstacles,
    selectedObstacleId,
    heading: drawnObstacles.length ? `Saved Obstacles (${drawnObstacles.length})` : null,
    highlightSelected: true,
    onSelect: selectObstacle,
    onRotate: rotateShed,
    onRemove: (id) => {
      drawnObstacles = drawnObstacles.filter((obstacle) => obstacle.id !== id);
      if (selectedObstacleId === id) {
        selectedObstacleId = null;
      }
      refreshObstacles();
      updateObstaclePositionNote();
      updateObstaclesList();
    },
  });
}

function selectObstacle(obstacleId) {
  selectedObstacleId = obstacleId;
  updateObstaclePositionNote();
  updateObstaclesList();
}

function rotateShed(obstacleId, deltaDeg) {
  drawnObstacles = rotateShedById(drawnObstacles, obstacleId, deltaDeg);
  selectedObstacleId = obstacleId;
  refreshObstacles();
  updateObstaclePositionNote();
  updateObstaclesList();
}

function nudgeSelectedObstacle(direction) {
  if (direction === 'clear') {
    selectedObstacleId = null;
    updateObstaclePositionNote();
    updateObstaclesList();
    return;
  }

  if (!selectedObstacleId) return;

  let dx = 0;
  let dy = 0;

  if (direction === 'north') dy = OBSTACLE_NUDGE_STEP_M;
  if (direction === 'south') dy = -OBSTACLE_NUDGE_STEP_M;
  if (direction === 'east') dx = OBSTACLE_NUDGE_STEP_M;
  if (direction === 'west') dx = -OBSTACLE_NUDGE_STEP_M;
  if (!dx && !dy) return;

  drawnObstacles = moveObstacleById(drawnObstacles, selectedObstacleId, dx, dy);
  refreshObstacles();
  updateSetupStatus(`${formatSelectedObstacleLabel()} moved ${Math.abs(dx || dy).toFixed(1)}m.`);
  updateObstaclePositionNote();
  updateObstaclesList();
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

function updateSetupStatus(message) {
  const statusEl = document.getElementById('site-setup-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function updateObstaclePositionNote() {
  const noteEl = document.getElementById('obstacle-position-note');
  if (!noteEl) return;

  if (!selectedObstacleId) {
    noteEl.textContent = 'Select an obstacle below, then nudge it around the map.';
    return;
  }

  noteEl.textContent = `${formatSelectedObstacleLabel()} selected. Use the arrows to reposition it in ${OBSTACLE_NUDGE_STEP_M.toFixed(1)}m steps.`;
}

function formatSelectedObstacleLabel() {
  return getSelectedObstacleLabel(drawnObstacles, selectedObstacleId);
}

function showPlacementBanner(text) {
  const banner = document.getElementById('site-setup-banner');
  const bannerText = document.getElementById('site-setup-banner-text');
  if (banner) {
    banner.classList.remove('hidden');
    if (bannerText) bannerText.textContent = text;
  }
}

function hidePlacementBanner() {
  const banner = document.getElementById('site-setup-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

function updateCancelFenceButton() {
  const cancelBtn = document.getElementById('btn-cancel-fence');
  if (cancelBtn) {
    const showCancel = pendingPlacement === 'fence' || fenceStartPoint != null;
    cancelBtn.classList.toggle('hidden', !showCancel);
  }
}

function handleEscapeKey(event) {
  if (event.key === 'Escape' && (pendingPlacement || fenceStartPoint)) {
    cancelPlacement();
    updateSetupStatus('Placement cancelled.');
  }
}

function getFootprintBounds(footprint) {
  if (!footprint?.length) return null;

  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  footprint.forEach((point) => {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return;
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

function saveBuilding() {
  const previousBuilding = (getState('buildings') || [])[0] || {};
  const detectedBuilding = map ? captureBuildingAtLocation(map, draftCenter, { searchRadiusM: 28 }) : null;
  const refreshedNearbyBuildings = map
    ? captureNearbyBuildings(map, draftCenter, {
      radiusM: 100,
      excludeContainingCenter: !detectedBuilding?.footprint?.length,
      excludeFootprint: detectedBuilding?.footprint?.length
        ? detectedBuilding.footprint.map(({ lat, lng }) => [lng, lat])
        : null,
    })
    : nearbyBuildings;

  nearbyBuildings = refreshedNearbyBuildings;

  setState({
    buildings: [
      {
        id: 'user-building',
        kind: 'user',
        height: detectedBuilding?.height || previousBuilding.height || DEFAULT_HEIGHT_M,
        lat: draftCenter?.lat,
        lng: draftCenter?.lng,
        widthM: DEFAULT_WIDTH_M,
        depthM: DEFAULT_DEPTH_M,
        frontDoorFacing: draftFrontDoorFacing,
        footprint: draftFootprint || detectedBuilding?.footprint || null,
      },
      ...refreshedNearbyBuildings,
    ],
    obstacles: drawnObstacles,
  });
}

function showSiteMapLoading(message) {
  const overlay = document.getElementById('buildings-map-loading');
  const text = document.getElementById('buildings-map-loading-text');
  if (text && message) {
    text.textContent = message;
  }
  overlay?.classList.remove('hidden');
}

function hideSiteMapLoading() {
  document.getElementById('buildings-map-loading')?.classList.add('hidden');
}

export function cleanup() {
  mapInitToken += 1;
  document.removeEventListener('keydown', handleEscapeKey);

  if (map) {
    map.remove();
    map = null;
  }

  mapLoaded = false;
  draftCenter = null;
  draftFootprint = null;
  draftFrontDoorFacing = null;
  nearbyBuildings = [];
  drawnObstacles = [];
  obstacleCounter = 0;
  selectedObstacleId = null;
  activeObstacleTool = 'fence';
  pendingPlacement = null;
  fenceStartPoint = null;
}
