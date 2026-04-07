import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';
import { calcHeight, formatHeight, getBuildingDescription, buildingPresets } from '../utils/buildings.js';

let map = null;

export function render() {
  const location = getState('location');
  const buildings = getState('buildings') || [];
  
  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">🏗️ Set Building Heights</h2>
        <p class="step-subtitle">Adjust heights of your building and nearby buildings for more accurate shadow analysis</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="buildings-map"></div>

        <div class="map-overlay-panel">
          <h4 style="margin-bottom: 12px;">Your Building</h4>
          
          <div class="form-group mb-md">
            <label class="form-label">Quick presets</label>
            <div class="building-preset-grid">
              ${buildingPresets.map((p, i) => `
                <div class="building-preset" data-preset="${i}" id="preset-${i}">
                  <div class="preset-icon">${p.icon}</div>
                  <div class="preset-label">${p.label}</div>
                  <div class="preset-height">${formatHeight(calcHeight(p.floors, p.pitched))}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Number of floors</label>
            <input type="number" class="form-input" id="floor-count" 
                   min="1" max="10" value="${buildings[0]?.floors || 2}" />
          </div>

          <div class="toggle-wrapper mb-md" id="pitched-toggle">
            <div class="toggle ${buildings[0]?.pitched ? 'active' : ''}" id="pitched-btn"></div>
            <span>Pitched roof (adds loft height)</span>
          </div>

          <div class="sun-score" style="margin-bottom: 16px;">
            <div class="sun-score-value" id="height-display">${formatHeight(calcHeight(buildings[0]?.floors || 2, buildings[0]?.pitched || false))}</div>
            <div class="sun-score-label">Estimated building height</div>
          </div>

          <div class="disclaimer">
            <span class="disclaimer-icon">ℹ️</span>
            <span>Shadow estimates are approximate. Adjust building heights for better accuracy. You can also click on neighbouring buildings to set their heights.</span>
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

  initMap(location);
  initControls();

  document.getElementById('btn-back-buildings')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-buildings')?.addEventListener('click', () => {
    saveBuilding();
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initMap(location) {
  map = new maplibregl.Map({
    container: 'buildings-map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [location.lng, location.lat],
    zoom: 17,
    pitch: 50,
    bearing: -20,
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  map.on('load', () => {
    add3DBuildings();
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

function initControls() {
  const floorInput = document.getElementById('floor-count');
  const pitchedBtn = document.getElementById('pitched-btn');
  const heightDisplay = document.getElementById('height-display');

  // Floor count change
  floorInput?.addEventListener('input', () => {
    updateHeight();
  });

  // Pitched roof toggle
  document.getElementById('pitched-toggle')?.addEventListener('click', () => {
    pitchedBtn?.classList.toggle('active');
    updateHeight();
  });

  // Presets
  document.querySelectorAll('.building-preset').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.preset);
      const preset = buildingPresets[idx];
      
      floorInput.value = preset.floors;
      
      if (preset.pitched) {
        pitchedBtn?.classList.add('active');
      } else {
        pitchedBtn?.classList.remove('active');
      }

      // Highlight active preset
      document.querySelectorAll('.building-preset').forEach(p => p.classList.remove('active'));
      el.classList.add('active');

      updateHeight();
    });
  });
}

function updateHeight() {
  const floors = parseInt(document.getElementById('floor-count')?.value) || 2;
  const pitched = document.getElementById('pitched-btn')?.classList.contains('active') || false;
  const height = calcHeight(floors, pitched);
  
  document.getElementById('height-display').textContent = formatHeight(height);
}

function saveBuilding() {
  const location = getState('location');
  const floors = parseInt(document.getElementById('floor-count')?.value) || 2;
  const pitched = document.getElementById('pitched-btn')?.classList.contains('active') || false;
  const height = calcHeight(floors, pitched);

  setState({
    buildings: [{
      id: 'user-building',
      floors,
      pitched,
      height,
      lat: location.lat,
      lng: location.lng,
      footprintRadius: 6,
    }]
  });
}

export function cleanup() {
  if (map) {
    map.remove();
    map = null;
  }
}
