import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';
import { degreesToCompass, getBearingBetweenPoints, getRectangleRing, latLngToMeters, metersToLatLng, normalizeDegrees } from '../utils/geometry.js';
import { samplePlacementHeatmap } from '../utils/sun.js';
import { createPanelMarkerElement, createStepMap, drawBuildingFootprintPreview, drawObstacles, drawSuitabilityHeatmap, updatePanelMarkerElement } from '../utils/map-helpers.js';

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

export function render() {
  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">✏️ Mark Spaces & Obstacles</h2>
        <p class="step-subtitle">Place candidate panel spots, then draw the fences, trees, and structures that could block them.</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="spaces-map"></div>

        <div class="map-placement-banner hidden" id="placement-banner">
          <span id="placement-banner-text">Click the map to place</span>
          <button class="btn btn-sm btn-secondary" id="btn-cancel-placement" style="padding: 4px 12px; font-size: 0.75rem;">✕ Cancel</button>
        </div>

        <div class="map-overlay-panel">
          <div class="mode-switch mb-md">
            <button class="mode-switch-btn active" data-mode="space">Panel Locations</button>
            <button class="mode-switch-btn" data-mode="obstacle">Obstacles</button>
          </div>

          <div id="panel-mode-panel">
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
                Pick the general facing if you know it. Fence-mounted panels snap to drawn fences, and wall mounts snap to the nearest house wall.
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
          </div>

          <div id="obstacle-mode-panel" class="hidden">
            <h4 style="margin-bottom: 12px;">Draw Obstacles</h4>

            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px;">
              Use satellite view if it helps. Fences and trees affect the analysis directly; sheds use a simple rectangular footprint.
            </p>

            <div class="form-group mb-md">
              <label class="form-label">Obstacle type</label>
              <div class="direction-grid">
                ${obstacleTools.map((tool) => `
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
                <label class="form-label">Rotation (° from North)</label>
                <input type="number" class="form-input" id="shed-rotation" min="0" max="359" step="5" value="0" />
              </div>
            </div>

            <button class="btn btn-primary w-full mb-md" id="btn-place-obstacle">
              🟧 Draw Fence
            </button>
            <button class="btn btn-secondary w-full mb-md hidden" id="btn-cancel-fence">
              ✕ Cancel Drawing
            </button>
          </div>

          <div class="analysis-note mb-md" id="placement-status">
            Choose a mode, then click the action button to place items on the map.
          </div>

          <div class="analysis-note mb-md">
            Heatmap guide: green = strongest direct sun, amber = mixed, red = weakest. It updates when you add or remove obstacles.
          </div>

          <div id="spaces-list"></div>
          <div id="obstacles-list"></div>
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
  drawnObstacles = [...(getState('obstacles') || [])];
  selectedSpaceId = getState('selectedSpaceId') || drawnSpaces[0]?.id || null;
  spaceCounter = drawnSpaces.length;
  obstacleCounter = drawnObstacles.length;

  initMap(location);
  initControls();
  updateSpacesList();
  updateObstaclesList();
  updateNextButton();
  setActiveMode(activeMode);
  setActiveObstacleTool(activeObstacleTool);

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
  map = createStepMap({
    container: 'spaces-map',
    center: [location.lng, location.lat],
    zoom: 18,
    pitch: 45,
    bearing: -20,
    onLoad: () => {
      drawHousePreview();
      drawnSpaces.forEach((space) => addMarkerToMap(space));
      refreshObstacles();
      queueHeatmapRefresh();
    },
  });

  map.on('click', (e) => {
    handleMapClick(e.lngLat.lat, e.lngLat.lng);
  });
}

function initControls() {
  document.querySelectorAll('.mode-switch-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveMode(button.dataset.mode);
    });
  });

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

  document.getElementById('btn-add-space')?.addEventListener('click', () => {
    setPendingPlacement('space');
  });

  document.querySelectorAll('[data-obstacle-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveObstacleTool(button.dataset.obstacleTool);
    });
  });

  document.getElementById('btn-place-obstacle')?.addEventListener('click', () => {
    setPendingPlacement(activeObstacleTool);
  });

  document.getElementById('btn-cancel-fence')?.addEventListener('click', () => {
    cancelPlacement();
    updatePlacementStatus('Drawing cancelled.');
  });

  document.getElementById('btn-cancel-placement')?.addEventListener('click', () => {
    cancelPlacement();
    updatePlacementStatus('Placement cancelled.');
  });

  // Escape key to cancel placement or fence drawing
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
  if (!pendingPlacement) return;

  if (pendingPlacement === 'space') {
    const space = addSpace(lat, lng);
    cancelPlacement();
    updatePlacementStatus(space?.alignmentHint ? `${space.alignmentHint}.` : 'Panel marker added.');
    return;
  }

  if (pendingPlacement === 'tree') {
    addTree(lat, lng);
    cancelPlacement();
    updatePlacementStatus('Tree added.');
    return;
  }

  if (pendingPlacement === 'shed') {
    addShed(lat, lng);
    cancelPlacement();
    updatePlacementStatus('Shed footprint added.');
    return;
  }

  if (!fenceStartPoint) {
    fenceStartPoint = { lat, lng };
    updatePlacementStatus('Fence start locked. Click the second point to finish the line.');
    showPlacementBanner('🟧 Click the fence end point (Esc to cancel)');
    updateCancelFenceButton();
    return;
  }

  addFence(fenceStartPoint, { lat, lng });
  cancelPlacement();
  updatePlacementStatus('Fence added.');
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
    rotationDeg: parseFloat(document.getElementById('shed-rotation')?.value || 0),
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

  const marker = new maplibregl.Marker({ element: el })
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

function queueHeatmapRefresh() {
  if (heatmapRefreshHandle) {
    clearTimeout(heatmapRefreshHandle);
  }

  heatmapRefreshHandle = setTimeout(() => {
    if (!map?.isStyleLoaded()) return;

    const center = map.getCenter();
    const buildings = getState('buildings') || [];
    const featureCollection = samplePlacementHeatmap(center.lat, center.lng, buildings, drawnObstacles, { radiusM: 18, stepM: 2 });
    drawSuitabilityHeatmap(map, featureCollection);
  }, 80);
}

function selectSpace(spaceId) {
  selectedSpaceId = spaceId;
  applyMarkerSelectionStyles();
  updateSpacesList();
  setState({ selectedSpaceId: spaceId });
}

function applyMarkerSelectionStyles() {
  markers.forEach((entry) => {
    const isSelected = entry.id === selectedSpaceId;
    const space = drawnSpaces.find((item) => item.id === entry.id) || { id: entry.id };
    updatePanelMarkerElement(entry.element, space, { selected: isSelected });
    entry.marker.setLngLat(entry.marker.getLngLat());
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
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = `
    <h4 style="margin: 16px 0 10px; font-size: 0.9rem; color: var(--text-secondary);">
      Drawn Obstacles (${drawnObstacles.length})
    </h4>
    ${drawnObstacles.map((obstacle) => `
      <div class="card-flat compact-row">
        <div>
          <strong style="font-size: 0.85rem;">${formatObstacleLabel(obstacle)}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            ${formatObstacleDetails(obstacle)}
          </div>
        </div>
        <button class="btn btn-sm btn-secondary remove-obstacle-btn" data-id="${obstacle.id}" style="padding: 4px 10px; font-size: 0.75rem;">✕</button>
      </div>
    `).join('')}
  `;

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
    return `${obstacle.widthM}m × ${obstacle.depthM}m · ${obstacle.heightM}m high`;
  }

  return `${obstacle.heightM}m high line`;
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
    noteEl.textContent = 'Fence-mounted panels snap onto the nearest drawn fence and inherit that fence line visually.';
    return;
  }

  if (typeId === 'wall') {
    noteEl.textContent = getPrimaryBuildingFootprint().length >= 3
      ? 'Click near a house wall to snap the panel onto that wall. The marker rotates to match the wall.'
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
    });
  }).sort((a, b) => a.distanceM - b.distanceM);

  return scored[0]?.distanceM <= SURFACE_SNAP_DISTANCE_M ? scored[0] : null;
}

function drawHousePreview() {
  const userBuilding = getPrimaryBuilding();
  if (!map?.isStyleLoaded() || !userBuilding) return;
  drawBuildingFootprintPreview(map, userBuilding);
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
    hint: options.hint || null,
  };
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
  if (heatmapRefreshHandle) {
    clearTimeout(heatmapRefreshHandle);
    heatmapRefreshHandle = null;
  }

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
}
