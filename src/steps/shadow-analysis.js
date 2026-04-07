import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';
import { getSunTimes, getMapLightFromSun, getShadowOverlayFeatures, rankSpaces, samplePlacementHeatmap } from '../utils/sun.js';
import { createStepMap, drawDynamicShadows, drawObstacles, drawSuitabilityHeatmap } from '../utils/map-helpers.js';

let map = null;
let animationFrame = null;
let isAnimating = false;
let markers = [];
let selectedSpaceId = null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function render() {
  const currentMonth = new Date().getMonth();

  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">☀️ Shadow Analysis</h2>
        <p class="step-subtitle">See visible moving shadows, compare candidate spots, and choose the one you want the ROI to use.</p>
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
                ${MONTHS.map((month, idx) => `
                  <button class="month-tab ${idx === currentMonth ? 'active' : ''}" data-month="${idx}">${month}</button>
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
              <div class="analysis-note" id="best-spot-meta" style="margin-top: 8px;"></div>
            </div>

            <div class="analysis-note" style="margin-top: 10px;">
              Green heatmap areas have the strongest year-round direct sun. Dark overlays show the current simulated shadow footprint for the selected time.
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
  selectedSpaceId = getState('selectedSpaceId');

  initMap(location);
  initControls();
  updateSunInfo();

  setTimeout(() => runAnalysis(), 400);

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
  map = createStepMap({
    container: 'shadow-map',
    center: [location.lng, location.lat],
    zoom: 17,
    pitch: 55,
    bearing: -30,
    onLoad: () => {
      addSpaceMarkers();
      drawObstacles(map, getState('obstacles') || []);
      drawSuitabilityHeatmap(map, samplePlacementHeatmap(location.lat, location.lng, getState('buildings') || [], getState('obstacles') || []));
      updateShadows();
    },
  });
}

function addSpaceMarkers() {
  const spaces = getState('spaces') || [];

  spaces.forEach((space) => {
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

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([space.centerLng, space.centerLat])
      .addTo(map);

    el.addEventListener('click', (event) => {
      event.stopPropagation();
      selectSpace(space.id);
    });

    markers.push({ id: space.id, marker, element: el });
  });

  applyMarkerSelectionStyles();
}

function initControls() {
  document.getElementById('time-slider')?.addEventListener('input', () => {
    updateShadows();
  });

  document.querySelectorAll('.month-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.month-tab').forEach((entry) => entry.classList.remove('active'));
      tab.classList.add('active');
      updateSunInfo();
      updateShadows();
    });
  });

  document.getElementById('btn-animate')?.addEventListener('click', () => {
    if (isAnimating) stopAnimation();
    else startAnimation();
  });
}

function getSelectedDate() {
  const activeMonth = document.querySelector('.month-tab.active');
  const month = parseInt(activeMonth?.dataset.month ?? new Date().getMonth(), 10);
  return new Date(new Date().getFullYear(), month, 15);
}

function getTimeFromSlider() {
  const location = getState('location');
  const date = getSelectedDate();
  const times = getSunTimes(date, location.lat, location.lng);
  const sliderVal = parseInt(document.getElementById('time-slider')?.value || 48, 10);
  const fraction = sliderVal / 96;
  const sunriseMs = times.sunrise.getTime();
  const sunsetMs = times.sunset.getTime();
  const padding = 30 * 60 * 1000;
  const timeMs = (sunriseMs - padding) + fraction * (sunsetMs - sunriseMs + (2 * padding));
  const result = new Date(timeMs);

  result.setFullYear(date.getFullYear());
  result.setMonth(date.getMonth());
  result.setDate(date.getDate());

  return result;
}

function updateShadows() {
  const location = getState('location');
  if (!location || !map) return;

  const time = getTimeFromSlider();
  const buildings = getState('buildings') || [];
  const obstacles = getState('obstacles') || [];
  const lightProps = getMapLightFromSun(time, location.lat, location.lng);

  document.getElementById('time-display').textContent =
    time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (map.isStyleLoaded()) {
    drawDynamicShadows(map, getShadowOverlayFeatures(time, location.lat, location.lng, buildings, obstacles));

    try {
      map.setLight({
        anchor: 'map',
        position: [1.5, lightProps.position[1], Math.max(10, lightProps.position[2])],
        intensity: lightProps.intensity,
        color: lightProps.color,
      });
    } catch (error) {
      // Some style/light combinations still ignore setLight; the analysis itself is unaffected.
    }
  }
}

function updateSunInfo() {
  const location = getState('location');
  if (!location) return;

  const date = getSelectedDate();
  const times = getSunTimes(date, location.lat, location.lng);
  const fmt = (value) => value ? value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '--:--';

  document.getElementById('sunrise-time').textContent = fmt(times.sunrise);
  document.getElementById('noon-time').textContent = fmt(times.solarNoon);
  document.getElementById('sunset-time').textContent = fmt(times.sunset);
}

function startAnimation() {
  isAnimating = true;
  const btn = document.getElementById('btn-animate');
  if (btn) btn.textContent = '⏸ Pause Animation';

  const slider = document.getElementById('time-slider');
  let val = parseFloat(slider?.value || 0);
  let lastTick = 0;

  function step(timestamp) {
    if (!isAnimating) return;

    if (!lastTick || (timestamp - lastTick) >= 140) {
      val = (val + 0.35) % 97;
      if (slider) slider.value = val;
      updateShadows();
      lastTick = timestamp;
    }

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
  const obstacles = getState('obstacles') || [];

  if (spaces.length === 0) return;

  const ranked = rankSpaces(location.lat, location.lng, spaces, buildings, obstacles);
  const nextSelectedSpaceId = resolveSelectedSpaceId(ranked);

  setState({
    sunAnalysis: {
      bestSpaceId: ranked[0]?.id,
      scores: ranked,
      date: new Date().toISOString(),
    },
    selectedSpaceId: nextSelectedSpaceId,
  });
  selectedSpaceId = nextSelectedSpaceId;

  renderSelectionSummary(ranked);
  renderRankingCards(ranked);
  applyMarkerSelectionStyles();
}

function renderRankingCards(ranked) {
  const rankingEl = document.getElementById('spaces-ranking');
  if (!rankingEl || ranked.length === 0) return;

  rankingEl.classList.remove('hidden');
  rankingEl.innerHTML = `
    <h4 style="margin: 16px 0 10px; font-size: 0.9rem; color: var(--text-secondary);">
      ⭐ Spot Rankings
    </h4>
    ${ranked.map((space, index) => `
      <div class="card-flat analysis-card ${space.id === selectedSpaceId ? 'analysis-card-best' : ''}" data-space-select="${space.id}">
        <div class="flex justify-between items-center" style="margin-bottom: 10px;">
          <div>
            <span style="font-weight: 700; color: ${index === 0 ? 'var(--accent)' : 'var(--text-primary)'};">
              #${index + 1}
            </span>
            <span style="font-size: 0.9rem; margin-left: 6px;">${space.typeIcon} ${space.name}</span>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; color: var(--accent); font-size: 1rem;">
              ${space.avgDailyHours}h/day
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">
              ${space.id === ranked[0]?.id ? 'Recommended' : (space.id === selectedSpaceId ? 'Chosen for ROI' : `${Math.round(space.shadowFactor * 100)}% direct sun`)}
            </div>
          </div>
        </div>

        <div class="badge-row" style="margin-bottom: 10px;">
          <span class="info-badge info-badge-${space.warningLevel}">
            ${getWarningIcon(space.warningLevel)} ${space.relativeDirectionLabel}
          </span>
          <span class="info-badge">
            Confidence: ${capitalise(space.confidence)}
          </span>
        </div>

        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 8px;">
          ${space.warnings.map((warning) => `<div>${warning}</div>`).join('')}
        </div>

        <div class="breakdown-row">
          <span>${formatBucket('Morning', space.breakdown.morning)}</span>
          <span>${formatBucket('Midday', space.breakdown.midday)}</span>
          <span>${formatBucket('Afternoon', space.breakdown.afternoon)}</span>
        </div>
      </div>
    `).join('')}
  `;

  rankingEl.querySelectorAll('[data-space-select]').forEach((card) => {
    card.addEventListener('click', () => {
      selectSpace(card.dataset.spaceSelect);
    });
  });
}

function renderSelectionSummary(ranked) {
  const bestSpotEl = document.getElementById('best-spot-result');
  const hoursEl = document.getElementById('best-spot-hours');
  const labelEl = document.getElementById('best-spot-label');
  const metaEl = document.getElementById('best-spot-meta');

  if (!bestSpotEl || ranked.length === 0) return;

  const selected = ranked.find((space) => space.id === selectedSpaceId) || ranked[0];
  const recommended = ranked[0];

  bestSpotEl.classList.remove('hidden');
  hoursEl.textContent = `${selected.avgDailyHours}h`;
  labelEl.textContent = `Using ${selected.name} for ROI`;
  metaEl.textContent = `${selected.relativeDirectionLabel} · ${capitalise(selected.confidence)} confidence · Shadow factor ${Math.round(selected.shadowFactor * 100)}%${selected.id !== recommended.id ? ` · Recommended spot is ${recommended.name}` : ''}`;
}

function selectSpace(spaceId) {
  selectedSpaceId = spaceId;
  setState({ selectedSpaceId: spaceId });
  const ranked = getState('sunAnalysis')?.scores || [];
  renderSelectionSummary(ranked);
  renderRankingCards(ranked);
  applyMarkerSelectionStyles();
}

function applyMarkerSelectionStyles() {
  markers.forEach((entry) => {
    const isSelected = entry.id === selectedSpaceId;
    entry.element.style.cssText = `
      width: ${isSelected ? 38 : 32}px;
      height: ${isSelected ? 38 : 32}px;
      background: ${isSelected ? 'linear-gradient(135deg, #22C55E, #16A34A)' : 'linear-gradient(135deg, #F59E0B, #EF4444)'};
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: ${isSelected ? '0 0 18px rgba(34, 197, 94, 0.55)' : '0 0 15px rgba(245,158,11,0.4)'};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      cursor: pointer;
      transform: ${isSelected ? 'scale(1.06)' : 'scale(1)'};
    `;
    entry.element.textContent = (getState('spaces') || []).find((space) => space.id === entry.id)?.typeIcon || '📍';
  });
}

function resolveSelectedSpaceId(ranked) {
  if (selectedSpaceId && ranked.some((space) => space.id === selectedSpaceId)) {
    return selectedSpaceId;
  }
  return ranked[0]?.id || null;
}

function getWarningIcon(level) {
  if (level === 'high') return '🔴';
  if (level === 'medium') return '🟡';
  return '🟢';
}

function formatBucket(label, value) {
  const icon = value === 'sun' ? '☀️' : value === 'mixed' ? '⛅' : '🌥️';
  return `${label} ${icon}`;
}

function capitalise(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function cleanup() {
  stopAnimation();
  markers.forEach((entry) => entry.marker.remove());
  markers = [];
  selectedSpaceId = null;

  if (map) {
    map.remove();
    map = null;
  }
}
