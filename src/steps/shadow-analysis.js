import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';
import { getSunPosition, getSunTimes, getMapLightFromSun, getDayPath, rankSpaces } from '../utils/sun.js';

let map = null;
let animationFrame = null;
let isAnimating = false;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function render() {
  const currentMonth = new Date().getMonth();
  
  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">☀️ Shadow Analysis</h2>
        <p class="step-subtitle">See how shadows move across your space throughout the day</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="shadow-map"></div>

        <div class="map-overlay-panel">
          <div class="shadow-controls">
            <div class="time-display" id="time-display">12:00</div>

            <div class="form-group">
              <label class="form-label">Time of day</label>
              <input type="range" class="range-slider" id="time-slider" 
                     min="0" max="96" value="48" step="1" />
              <div class="flex justify-between" style="font-size: 0.7rem; color: var(--text-muted);">
                <span>Sunrise</span>
                <span>Noon</span>
                <span>Sunset</span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Month</label>
              <div class="month-tabs">
                ${MONTHS.map((m, i) => `
                  <button class="month-tab ${i === currentMonth ? 'active' : ''}" data-month="${i}">${m}</button>
                `).join('')}
              </div>
            </div>

            <button class="btn btn-outline w-full" id="btn-animate">
              ▶ Animate Sun Path
            </button>

            <div id="sun-info" class="card-flat" style="padding: 12px;">
              <div class="flex justify-between mb-sm">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">🌅 Sunrise</span>
                <span style="font-size: 0.85rem; font-weight: 600;" id="sunrise-time">--:--</span>
              </div>
              <div class="flex justify-between mb-sm">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">☀️ Solar Noon</span>
                <span style="font-size: 0.85rem; font-weight: 600;" id="noon-time">--:--</span>
              </div>
              <div class="flex justify-between">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">🌇 Sunset</span>
                <span style="font-size: 0.85rem; font-weight: 600;" id="sunset-time">--:--</span>
              </div>
            </div>

            <div id="best-spot-result" class="hidden">
              <div class="sun-score">
                <div class="sun-score-value" id="best-spot-hours">--</div>
                <div class="sun-score-label" id="best-spot-label">Analysing sun exposure...</div>
              </div>
            </div>

            <div id="spaces-ranking" class="hidden"></div>
          </div>
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-shadow">← Back</button>
        <button class="btn btn-primary" id="btn-next-shadow">Continue →</button>
      </div>
    </div>
  `;
}

export function init() {
  const location = getState('location');
  if (!location) return;

  initMap(location);
  initControls();
  updateSunInfo();

  // Run shadow analysis
  setTimeout(() => runAnalysis(), 1000);

  document.getElementById('btn-back-shadow')?.addEventListener('click', () => {
    stopAnimation();
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-shadow')?.addEventListener('click', () => {
    stopAnimation();
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initMap(location) {
  map = new maplibregl.Map({
    container: 'shadow-map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [location.lng, location.lat],
    zoom: 17,
    pitch: 55,
    bearing: -30,
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  map.on('load', () => {
    add3DBuildings();
    addSpaceMarkers();
    updateShadows();
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
      'fill-extrusion-opacity': 0.8,
    },
  }, labelLayerId);
}

function addSpaceMarkers() {
  const spaces = getState('spaces') || [];
  
  spaces.forEach((space, i) => {
    const el = document.createElement('div');
    el.style.cssText = `
      width: 32px; height: 32px;
      background: linear-gradient(135deg, #F59E0B, #EF4444);
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 0 15px rgba(245,158,11,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; cursor: pointer;
    `;
    el.textContent = space.typeIcon || '📍';

    new maplibregl.Marker({ element: el })
      .setLngLat([space.centerLng, space.centerLat])
      .addTo(map);
  });
}

function initControls() {
  const timeSlider = document.getElementById('time-slider');
  
  timeSlider?.addEventListener('input', () => {
    updateShadows();
  });

  // Month tabs
  document.querySelectorAll('.month-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.month-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      updateSunInfo();
      updateShadows();
    });
  });

  // Animate button
  document.getElementById('btn-animate')?.addEventListener('click', () => {
    if (isAnimating) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });
}

function getSelectedDate() {
  const activeMonth = document.querySelector('.month-tab.active');
  const month = parseInt(activeMonth?.dataset.month ?? new Date().getMonth());
  const year = new Date().getFullYear();
  return new Date(year, month, 15);
}

function getTimeFromSlider() {
  const location = getState('location');
  const date = getSelectedDate();
  const times = getSunTimes(date, location.lat, location.lng);
  
  const sliderVal = parseInt(document.getElementById('time-slider')?.value || 48);
  const fraction = sliderVal / 96;
  
  // Map slider to sunrise-sunset range (with padding)
  const sunriseMs = times.sunrise.getTime();
  const sunsetMs = times.sunset.getTime();
  const padding = 30 * 60 * 1000; // 30 min padding
  
  const timeMs = (sunriseMs - padding) + fraction * (sunsetMs - sunriseMs + 2 * padding);
  const result = new Date(timeMs);
  
  // Ensure same date
  result.setFullYear(date.getFullYear());
  result.setMonth(date.getMonth());
  result.setDate(date.getDate());
  
  return result;
}

function updateShadows() {
  const location = getState('location');
  if (!location || !map) return;

  const time = getTimeFromSlider();
  const lightProps = getMapLightFromSun(time, location.lat, location.lng);
  
  // Update time display
  document.getElementById('time-display').textContent = 
    time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // Update map light to simulate sun position
  if (map.isStyleLoaded()) {
    try {
      map.setLight({
        anchor: 'map',
        position: [1.5, lightProps.position[1], Math.max(10, lightProps.position[2])],
        intensity: lightProps.intensity,
        color: lightProps.color,
      });
    } catch (e) {
      // Light API may not be fully available in all styles
    }
  }
}

function updateSunInfo() {
  const location = getState('location');
  if (!location) return;

  const date = getSelectedDate();
  const times = getSunTimes(date, location.lat, location.lng);

  const fmt = (d) => d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  
  document.getElementById('sunrise-time').textContent = fmt(times.sunrise);
  document.getElementById('noon-time').textContent = fmt(times.solarNoon);
  document.getElementById('sunset-time').textContent = fmt(times.sunset);
}

function startAnimation() {
  isAnimating = true;
  const btn = document.getElementById('btn-animate');
  if (btn) btn.textContent = '⏸ Pause Animation';
  
  const slider = document.getElementById('time-slider');
  let val = 0;
  
  function step() {
    if (!isAnimating) return;
    
    val = (val + 0.5) % 97;
    if (slider) slider.value = val;
    updateShadows();
    
    animationFrame = requestAnimationFrame(step);
  }
  
  animationFrame = requestAnimationFrame(step);
}

function stopAnimation() {
  isAnimating = false;
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  const btn = document.getElementById('btn-animate');
  if (btn) btn.textContent = '▶ Animate Sun Path';
}

function runAnalysis() {
  const location = getState('location');
  const spaces = getState('spaces') || [];
  const buildings = getState('buildings') || [];
  
  if (spaces.length === 0) return;

  // Rank spaces by sun exposure
  const ranked = rankSpaces(location.lat, location.lng, spaces, buildings);
  
  // Save analysis
  setState({
    sunAnalysis: {
      bestSpaceId: ranked[0]?.id,
      scores: ranked,
      date: new Date().toISOString(),
    }
  });

  // Update best spot display
  const bestSpotEl = document.getElementById('best-spot-result');
  const hoursEl = document.getElementById('best-spot-hours');
  const labelEl = document.getElementById('best-spot-label');
  
  if (bestSpotEl && ranked.length > 0) {
    bestSpotEl.classList.remove('hidden');
    hoursEl.textContent = `${ranked[0].avgDailyHours}h`;
    labelEl.textContent = `Best spot: ${ranked[0].name}`;
  }

  // Show rankings
  const rankingEl = document.getElementById('spaces-ranking');
  if (rankingEl && ranked.length > 0) {
    rankingEl.classList.remove('hidden');
    rankingEl.innerHTML = `
      <h4 style="margin: 16px 0 10px; font-size: 0.9rem; color: var(--text-secondary);">
        ⭐ Spot Rankings
      </h4>
      ${ranked.map((s, i) => `
        <div class="card-flat" style="padding: 10px 14px; margin-bottom: 8px; ${i === 0 ? 'border-color: var(--accent); box-shadow: 0 0 10px rgba(245,158,11,0.15);' : ''}">
          <div class="flex justify-between items-center">
            <div>
              <span style="font-weight: 700; color: ${i === 0 ? 'var(--accent)' : 'var(--text-primary)'};">
                #${i + 1}
              </span>
              <span style="font-size: 0.85rem; margin-left: 6px;">${s.typeIcon} ${s.name}</span>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color: var(--accent); font-size: 1rem;">
                ${s.avgDailyHours}h/day
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">
                ~${s.annualHours}h/year
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    `;
  }
}

export function cleanup() {
  stopAnimation();
  if (map) {
    map.remove();
    map = null;
  }
}
