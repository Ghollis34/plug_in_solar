import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';

let map = null;
let drawingMode = false;
let currentPolygon = [];
let drawnSpaces = [];
let markers = [];
let spaceCounter = 0;

const spaceTypes = [
  { id: 'railing', icon: '🏗️', label: 'Balcony Railing' },
  { id: 'wall', icon: '🧱', label: 'Wall Mount' },
  { id: 'fence', icon: '🌳', label: 'Garden Fence' },
  { id: 'flat-roof', icon: '🏠', label: 'Flat Roof / Shed' },
  { id: 'ground', icon: '🌿', label: 'Ground / Garden' },
];

export function render() {
  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">✏️ Mark Your Spaces</h2>
        <p class="step-subtitle">Click on the map to mark areas where you could place solar panels</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="spaces-map"></div>

        <div class="map-overlay-panel">
          <h4 style="margin-bottom: 12px;">Add Panel Locations</h4>

          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px;">
            Click on the map to mark spots where panels could go. Add at least one location to continue.
          </p>

          <div class="form-group mb-md">
            <label class="form-label">Surface type</label>
            <div class="space-type-grid">
              ${spaceTypes.map(t => `
                <button class="space-type-btn ${t.id === 'ground' ? 'active' : ''}" data-type="${t.id}" id="type-${t.id}">
                  <span class="type-icon">${t.icon}</span>
                  ${t.label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Panel direction (°from North)</label>
            <div class="flex items-center gap-md">
              <input type="range" class="range-slider" id="orientation-slider" 
                     min="0" max="360" value="180" />
              <span id="orientation-value" style="min-width: 50px; text-align: right; font-weight: 600;">180° S</span>
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
            📌 Place Marker on Map
          </button>

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

  // Restore saved spaces
  const savedSpaces = getState('spaces');
  if (savedSpaces && savedSpaces.length > 0) {
    drawnSpaces = [...savedSpaces];
    spaceCounter = drawnSpaces.length;
  }

  initMap(location);
  initControls();

  document.getElementById('btn-back-spaces')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-spaces')?.addEventListener('click', () => {
    setState({ spaces: drawnSpaces });
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initMap(location) {
  map = new maplibregl.Map({
    container: 'spaces-map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [location.lng, location.lat],
    zoom: 18,
    pitch: 45,
    bearing: -20,
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  map.on('load', () => {
    add3DBuildings();
    
    // Re-add saved markers
    drawnSpaces.forEach(space => {
      addMarkerToMap(space);
    });
    updateSpacesList();
    updateNextButton();
  });

  // Map click to add space
  map.on('click', (e) => {
    if (drawingMode) {
      addSpace(e.lngLat.lat, e.lngLat.lng);
      drawingMode = false;
      map.getCanvas().style.cursor = '';
    }
  });
}

function add3DBuildings() {
  const layers = map.getStyle().layers;
  let labelLayerId;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
      labelLayerId = layers[i].id;
      break;
    }
  }

  map.addLayer({
    id: '3d-buildings',
    source: 'openmaptiles',
    'source-layer': 'building',
    type: 'fill-extrusion',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#3D4A5C',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.7,
    },
  }, labelLayerId);
}

function initControls() {
  // Surface type selection
  document.querySelectorAll('.space-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.space-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Orientation slider
  const orientSlider = document.getElementById('orientation-slider');
  const orientValue = document.getElementById('orientation-value');
  orientSlider?.addEventListener('input', () => {
    const deg = parseInt(orientSlider.value);
    orientValue.textContent = `${deg}° ${getCompassDirection(deg)}`;
  });

  // Tilt slider
  const tiltSlider = document.getElementById('tilt-slider');
  const tiltValue = document.getElementById('tilt-value');
  tiltSlider?.addEventListener('input', () => {
    tiltValue.textContent = `${tiltSlider.value}°`;
  });

  // Add space button
  document.getElementById('btn-add-space')?.addEventListener('click', () => {
    drawingMode = true;
    map.getCanvas().style.cursor = 'crosshair';
  });
}

function addSpace(lat, lng) {
  spaceCounter++;
  const activeType = document.querySelector('.space-type-btn.active');
  const typeId = activeType?.dataset.type || 'ground';
  const typeInfo = spaceTypes.find(t => t.id === typeId);
  const orientation = parseInt(document.getElementById('orientation-slider')?.value || 180);
  const tilt = parseInt(document.getElementById('tilt-slider')?.value || 35);

  const space = {
    id: `space-${spaceCounter}`,
    name: `${typeInfo?.label || 'Space'} ${spaceCounter}`,
    type: typeId,
    typeIcon: typeInfo?.icon || '📍',
    centerLat: lat,
    centerLng: lng,
    orientation,
    tilt,
    orientationLabel: `${orientation}° ${getCompassDirection(orientation)}`,
  };

  drawnSpaces.push(space);
  addMarkerToMap(space);
  updateSpacesList();
  updateNextButton();
}

function addMarkerToMap(space) {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 36px; height: 36px; 
    background: linear-gradient(135deg, #F59E0B, #EF4444); 
    border-radius: 50%; 
    border: 3px solid white; 
    box-shadow: 0 0 20px rgba(245,158,11,0.4);
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; cursor: pointer;
  `;
  el.textContent = space.typeIcon;

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([space.centerLng, space.centerLat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`
      <strong>${space.name}</strong><br/>
      <span style="font-size: 0.8rem; color: #94A3B8;">
        ${space.orientationLabel} · ${space.tilt}° tilt
      </span>
    `))
    .addTo(map);

  markers.push({ id: space.id, marker });
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
    ${drawnSpaces.map(s => `
      <div class="card-flat" style="padding: 10px 14px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <span>${s.typeIcon}</span>
          <strong style="font-size: 0.85rem;">${s.name}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            ${s.orientationLabel} · ${s.tilt}° tilt
          </div>
        </div>
        <button class="btn btn-sm btn-secondary remove-space-btn" data-id="${s.id}" style="padding: 4px 10px; font-size: 0.75rem;">✕</button>
      </div>
    `).join('')}
  `;

  // Remove buttons
  listEl.querySelectorAll('.remove-space-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      drawnSpaces = drawnSpaces.filter(s => s.id !== id);
      const markerObj = markers.find(m => m.id === id);
      if (markerObj) {
        markerObj.marker.remove();
        markers = markers.filter(m => m.id !== id);
      }
      updateSpacesList();
      updateNextButton();
    });
  });
}

function updateNextButton() {
  const btn = document.getElementById('btn-next-spaces');
  if (btn) {
    btn.disabled = drawnSpaces.length === 0;
  }
}

function getCompassDirection(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

export function cleanup() {
  if (map) {
    map.remove();
    map = null;
  }
  markers = [];
  drawingMode = false;
}
