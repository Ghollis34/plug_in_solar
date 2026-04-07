import { getState, setState } from '../utils/state.js';
import { calcHeight, formatHeight, buildingPresets } from '../utils/buildings.js';
import { captureBuildingAtLocation, captureNearbyBuildings, createStepMap, drawBuildingFootprintPreview } from '../utils/map-helpers.js';
import { degreesToCompass, latLngToMeters, metersToLatLng } from '../utils/geometry.js';

let map = null;
let mapLoaded = false;
let draftCenter = null;
let draftFrontDoorFacing = null;
let nearbyBuildings = [];

const DEFAULT_WIDTH_M = 5;
const DEFAULT_DEPTH_M = 9;
const NUDGE_STEP_M = 1.5;
const FRONT_DOOR_OPTIONS = [
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
  const location = getState('location');
  const building = (getState('buildings') || [])[0] || {};
  const floors = building.floors || 2;
  const pitched = Boolean(building.pitched);
  const height = calcHeight(floors, pitched);
  const facing = building.frontDoorFacing;
  const facingValue = facing ?? 180;

  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">🏗️ Set Building Height & Direction</h2>
        <p class="step-subtitle">Tune the house footprint a bit more precisely so the shade model has a better anchor.</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="buildings-map"></div>

        <div class="map-overlay-panel">
          <h4 style="margin-bottom: 12px;">Your Building</h4>

          <div class="form-group mb-md">
            <label class="form-label">Quick presets</label>
            <div class="building-preset-grid">
              ${buildingPresets.map((preset, i) => `
                <div class="building-preset ${preset.floors === floors && preset.pitched === pitched ? 'active' : ''}" data-preset="${i}">
                  <div class="preset-icon">${preset.icon}</div>
                  <div class="preset-label">${preset.label}</div>
                  <div class="preset-height">${formatHeight(calcHeight(preset.floors, preset.pitched))}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Number of floors</label>
            <input type="number" class="form-input" id="floor-count" min="1" max="10" value="${floors}" />
          </div>

          <div class="toggle-wrapper mb-md" id="pitched-toggle">
            <div class="toggle ${pitched ? 'active' : ''}" id="pitched-btn"></div>
            <span>Pitched roof (adds loft height)</span>
          </div>

          <div class="form-group mb-md">
            <div class="flex justify-between items-center" style="margin-bottom: 8px;">
              <label class="form-label">Front door direction</label>
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
                ? 'Leave this unset if you are unsure. We will lower confidence and use a more conservative house model.'
                : `Front door set to ${degreesToCompass(facing, 'long')}. Use the slider if the 8-point compass is too coarse.`}
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Footprint position</label>
            <div class="nudge-grid">
              <button class="direction-chip" data-nudge="north" type="button">↑</button>
              <button class="direction-chip" data-nudge="west" type="button">←</button>
              <button class="direction-chip" data-nudge="reset" type="button">Reset</button>
              <button class="direction-chip" data-nudge="east" type="button">→</button>
              <button class="direction-chip" data-nudge="south" type="button">↓</button>
            </div>
            <div class="analysis-note" id="position-note" style="margin-top: 10px;">
              Start with the postcode pin, then nudge the outline until it sits roughly over the house.
            </div>
          </div>

          <div class="sun-score" style="margin-bottom: 16px;">
            <div class="sun-score-value" id="height-display">${formatHeight(height)}</div>
            <div class="sun-score-label">Estimated building height</div>
          </div>

        <div class="card-flat" style="padding: 12px; margin-bottom: 12px;">
          <div style="font-weight: 600; margin-bottom: 4px;">Assumed footprint</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary);">
              ${DEFAULT_WIDTH_M}m wide × ${DEFAULT_DEPTH_M}m deep. The dashed outline updates as you tweak direction or nudge position.
          </div>
        </div>

          <div class="analysis-note" id="nearby-buildings-note" style="margin-bottom: 12px;">
            Nearby buildings within roughly 100m will also be included in the shade model.
          </div>

          <div class="disclaimer">
            <span class="disclaimer-icon">ℹ️</span>
            <span>This is still approximate, but it is enough to stop obvious north-side placements being overstated.</span>
          </div>
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

  const building = (getState('buildings') || [])[0] || {};
  draftCenter = {
    lat: Number.isFinite(building.lat) ? building.lat : location.lat,
    lng: Number.isFinite(building.lng) ? building.lng : location.lng,
  };
  draftFrontDoorFacing = Number.isFinite(building.frontDoorFacing) ? building.frontDoorFacing : null;

  initMap(location);
  initControls();
  updateHeight();
  updateDirectionUI();
  updatePositionNote();

  document.getElementById('btn-back-buildings')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-buildings')?.addEventListener('click', () => {
    saveBuilding();
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initMap(location) {
  map = createStepMap({
    container: 'buildings-map',
    center: [location.lng, location.lat],
    zoom: 17,
    pitch: 50,
    bearing: -20,
    onLoad: () => {
      mapLoaded = true;
      captureNeighborBuildings();
      updateDirectionPreview();
    },
  });
}

function initControls() {
  const floorInput = document.getElementById('floor-count');
  const pitchedBtn = document.getElementById('pitched-btn');

  floorInput?.addEventListener('input', updateHeight);

  document.getElementById('pitched-toggle')?.addEventListener('click', () => {
    pitchedBtn?.classList.toggle('active');
    updateHeight();
  });

  document.querySelectorAll('.building-preset').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.preset, 10);
      const preset = buildingPresets[idx];
      if (!preset) return;

      floorInput.value = preset.floors;
      pitchedBtn?.classList.toggle('active', preset.pitched);
      document.querySelectorAll('.building-preset').forEach((presetEl) => presetEl.classList.remove('active'));
      el.classList.add('active');
      updateHeight();
    });
  });

  document.querySelectorAll('.direction-chip[data-facing]').forEach((button) => {
    button.addEventListener('click', () => {
      const facing = parseInt(button.dataset.facing, 10);
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
  } else {
    let dx = 0;
    let dy = 0;

    if (direction === 'north') dy = NUDGE_STEP_M;
    if (direction === 'south') dy = -NUDGE_STEP_M;
    if (direction === 'east') dx = NUDGE_STEP_M;
    if (direction === 'west') dx = -NUDGE_STEP_M;

    draftCenter = metersToLatLng(draftCenter.lat, draftCenter.lng, dx, dy);
  }

  updatePositionNote();
  updateDirectionPreview();
}

function updateHeight() {
  const floors = parseInt(document.getElementById('floor-count')?.value, 10) || 2;
  const pitched = document.getElementById('pitched-btn')?.classList.contains('active') || false;
  const height = calcHeight(floors, pitched);
  document.getElementById('height-display').textContent = formatHeight(height);
}

function updateDirectionUI() {
  const slider = document.getElementById('front-door-slider');
  const valueEl = document.getElementById('front-door-value');
  const noteEl = document.getElementById('direction-note');

  if (slider && draftFrontDoorFacing != null) {
    slider.value = String(draftFrontDoorFacing);
  }

  document.querySelectorAll('.direction-chip[data-facing]').forEach((chip) => {
    chip.classList.toggle('active', parseInt(chip.dataset.facing, 10) === draftFrontDoorFacing);
  });

  if (valueEl) {
    valueEl.textContent = draftFrontDoorFacing == null
      ? 'Unset'
      : `${degreesToCompass(draftFrontDoorFacing, 'long')} (${draftFrontDoorFacing}°)`;
  }

  if (noteEl) {
    noteEl.textContent = draftFrontDoorFacing == null
      ? 'Leave this unset if you are unsure. We will lower confidence and use a more conservative house model.'
      : `Front door set to ${degreesToCompass(draftFrontDoorFacing, 'long')}. Use the slider if the 8-point compass is too coarse.`;
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
    noteEl.textContent = 'Outline is centred on the postcode pin.';
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
  });
}

function captureNeighborBuildings() {
  if (!map || !draftCenter) return;

  nearbyBuildings = captureNearbyBuildings(map, draftCenter, { radiusM: 100, excludeRadiusM: 12 });
  const noteEl = document.getElementById('nearby-buildings-note');
  if (noteEl) {
    noteEl.textContent = nearbyBuildings.length > 0
      ? `${nearbyBuildings.length} neighbouring buildings detected within roughly 100m and will be considered for shading.`
      : 'No neighbouring buildings were detected in the current view, so only your building and manual obstacles will be used.';
  }
}

function saveBuilding() {
  const floors = parseInt(document.getElementById('floor-count')?.value, 10) || 2;
  const pitched = document.getElementById('pitched-btn')?.classList.contains('active') || false;
  const height = calcHeight(floors, pitched);
  const detectedBuilding = map ? captureBuildingAtLocation(map, draftCenter, { searchRadiusM: 28 }) : null;

  setState({
    buildings: [
      {
        id: 'user-building',
        kind: 'user',
        floors,
        pitched,
        height,
        lat: draftCenter?.lat,
        lng: draftCenter?.lng,
        widthM: DEFAULT_WIDTH_M,
        depthM: DEFAULT_DEPTH_M,
        frontDoorFacing: draftFrontDoorFacing,
        footprint: detectedBuilding?.footprint || null,
      },
      ...nearbyBuildings,
    ],
  });
}

export function cleanup() {
  if (map) {
    map.remove();
    map = null;
  }

  mapLoaded = false;
  draftCenter = null;
  draftFrontDoorFacing = null;
  nearbyBuildings = [];
}
