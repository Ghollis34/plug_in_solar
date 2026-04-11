import { getState, setState } from '../utils/state.js';
import { createMapStepSession } from '../utils/map-step-session.js';

let map = null;
let marker = null;
let searchTimeout = null;
let searchAbortController = null;
let searchRequestId = 0;
let outsideClickHandler = null;
let mapRuntime = null;

const mapSession = createMapStepSession();

export function render() {
  return `
    <div class="step-page step-page-map">
      <div class="step-header">
        <div class="section-kicker">Step 1 · Location</div>
        <h2 class="step-title">Find Your Location</h2>
        <p class="step-subtitle">Search your UK postcode or address, then confirm the property in 3D before you model the building and panel spots.</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="location-map"></div>
        <div class="map-loading-overlay" id="location-map-loading">
          <div class="loading-spinner"></div>
          <div id="location-map-loading-text">Loading UK map…</div>
        </div>
        <div class="map-overlay-bottom map-overlay-bottom-legend">
          <div class="map-legend-title">Map guide</div>
          <div class="map-legend-copy">Drag to pan, scroll to zoom, and right- or middle-drag to rotate in 3D. Use the compass to reset north-up after you orbit the map.</div>
        </div>

        <div class="map-overlay-panel map-overlay-panel-location">
          <div class="map-panel-header">
            <div>
              <div class="map-panel-kicker">Property Search</div>
              <h3 class="map-panel-title">Choose the building you want to assess</h3>
            </div>
            <div class="map-panel-pill">UK only</div>
          </div>

          <div class="form-group mb-md">
            <label class="form-label">Search postcode or address</label>
            <div class="search-wrapper search-wrapper-premium">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-input" id="location-search"
                     placeholder="e.g. SW1A 1AA or 10 Downing Street"
                     autocomplete="off" />
              <div class="search-results hidden" id="search-results"></div>
            </div>
          </div>

          <div class="card-flat card-flat-subtle task-guide-card">
            <div class="task-guide-header">
              <div class="task-guide-title">What To Do On This Step</div>
              <div class="task-guide-summary" id="location-guide-summary">
                Search or click the map to choose the property you want us to assess.
              </div>
            </div>
            <div class="task-guide-list">
              <div class="task-guide-item">
                <span class="task-guide-index">1</span>
                <div class="task-guide-copy">
                  <strong>Find the property</strong>
                  <span>Type a postcode or address, or click directly on the map if search misses it.</span>
                </div>
                <span class="task-guide-status" id="location-guide-search-status">To do</span>
              </div>
              <div class="task-guide-item">
                <span class="task-guide-index">2</span>
                <div class="task-guide-copy">
                  <strong>Check the pin is on the right home</strong>
                  <span>Once selected, the map will fly in and show a marker on the property.</span>
                </div>
                <span class="task-guide-status" id="location-guide-confirm-status">Waiting</span>
              </div>
              <div class="task-guide-item">
                <span class="task-guide-index">3</span>
                <div class="task-guide-copy">
                  <strong>Move to site setup</strong>
                  <span>Continue when the marker sits on the building you want quoted.</span>
                </div>
                <span class="task-guide-status" id="location-guide-next-status">Locked</span>
              </div>
            </div>
          </div>

          <div id="location-info" class="location-selection-card hidden">
            <div class="location-selection-topline">
              <div>
                <div class="location-selection-title" id="location-name"></div>
                <div class="location-selection-meta">Selected property</div>
              </div>
              <span class="location-selection-status">Confirmed</span>
            </div>
            <div class="location-selection-coords" id="location-coords"></div>
          </div>

          <div class="disclaimer mt-md">
            <span class="disclaimer-icon">ℹ️</span>
            <span>Click directly on the map if you want to pin a building manually. Orbit the map until the building shape looks right, then use the compass if you need to re-orient north-up.</span>
          </div>
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-location">← Back</button>
        <button class="btn btn-primary" id="btn-next-location" disabled>
          Continue To Site Setup →
        </button>
      </div>
    </div>
  `;
}

export function init() {
  const token = mapSession.beginRun();
  showLocationMapLoading('Loading UK map…');
  initSearch();
  updateLocationGuide();

  mapSession.ensureRuntime(token)
    .then((runtime) => {
      if (!runtime) return null;
      mapRuntime = runtime;
      return initMap(token);
    })
    .then((createdMap) => {
      if (!createdMap || !mapSession.isCurrent(token)) return;
      map = createdMap;
      bindMapInteractions();
    })
    .then(() => {
      if (!mapSession.isCurrent(token)) return;

      // Restore saved location or clear stale input
      const saved = getState('location');
      const searchInput = document.getElementById('location-search');
      if (saved) {
        setLocation(saved.lat, saved.lng, saved.displayName, { preserveDownstream: true });
        if (searchInput) searchInput.value = saved.displayName || '';
      } else if (searchInput) {
        searchInput.value = '';
        updateLocationGuide();
      }
    })
    .catch((error) => {
      if (!mapSession.isCurrent(token)) return;
      console.error('Failed to load location map:', error);
      showLocationMapLoading('Failed to load map. Refresh or try again.');
    });

  document.getElementById('btn-back-location')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-location')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initMap(token) {
  return mapSession.createMap(token, {
    container: 'location-map',
    center: [-1.5, 53.0], // Centre of UK
    zoom: 6,
    pitch: 0,
    bearing: 0,
    maxBounds: [[-12, 49], [4, 61]], // UK bounds
    onLoad: (mapInstance) => {
      map = mapInstance;
      if (mapSession.isCurrent(token)) {
        hideLocationMapLoading();
      }
    },
  });
}

function bindMapInteractions() {
  if (!map) return;

  map.on('click', (e) => {
    const { lng, lat } = e.lngLat;
    reverseGeocode(lat, lng);
  });
}

function initSearch() {
  const input = document.getElementById('location-search');
  const resultsEl = document.getElementById('search-results');

  input?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (query.length < 3) {
      resultsEl?.classList.add('hidden');
      return;
    }

    searchTimeout = setTimeout(() => searchPlaces(query), 400);
  });

  // Close results on click outside
  outsideClickHandler = (e) => {
    if (!e.target.closest('.search-wrapper')) {
      resultsEl?.classList.add('hidden');
    }
  };

  document.addEventListener('mousedown', outsideClickHandler);
}

async function searchPlaces(query) {
  const resultsEl = document.getElementById('search-results');
  const requestId = ++searchRequestId;
  searchAbortController?.abort();
  searchAbortController = new AbortController();
  
  try {
    // Use Nominatim for free geocoding (UK bounded)
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'gb',
      viewbox: '-8,49,2,61',
      bounded: '1',
    });

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'Accept-Language': 'en' },
      signal: searchAbortController.signal,
      referrerPolicy: 'no-referrer',
    });
    const data = await res.json();

    if (requestId !== searchRequestId) {
      return;
    }

    if (data.length === 0) {
      resultsEl.replaceChildren(createSearchResultMessage('No results found'));
      resultsEl.classList.remove('hidden');
      return;
    }

    const fragment = document.createDocumentFragment();
    data.forEach((place, i) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.dataset.idx = String(i);
      item.textContent = place.display_name;
      fragment.appendChild(item);
    });

    resultsEl.replaceChildren(fragment);

    resultsEl.classList.remove('hidden');

    // Add click handlers — use mousedown so it fires before blur/outside-click
    resultsEl.querySelectorAll('.search-result-item[data-idx]').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur
        e.stopPropagation(); // Prevent outside-click handler
        const idx = parseInt(item.dataset.idx);
        const place = data[idx];
        if (!place) return;
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        setLocation(lat, lng, place.display_name);
        resultsEl.classList.add('hidden');
        document.getElementById('location-search').value = place.display_name;
      });
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return;
    }
    console.error('Search failed:', err);
  }
}

function createSearchResultMessage(message) {
  const item = document.createElement('div');
  item.className = 'search-result-item';
  item.style.color = 'var(--text-muted)';
  item.textContent = message;
  return item;
}

async function reverseGeocode(lat, lng) {
  try {
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      format: 'json',
      addressdetails: '1',
    });

    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'Accept-Language': 'en' },
      referrerPolicy: 'no-referrer',
    });
    const data = await res.json();
    
    const name = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setLocation(lat, lng, name);
    document.getElementById('location-search').value = name;
  } catch (err) {
    // Still set location even if reverse geocode fails
    setLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  }
}

function setLocation(lat, lng, displayName, options = {}) {
  const preserveDownstream = options.preserveDownstream === true;

  // Update state
  setState({
    location: { lat, lng, displayName },
    ...(preserveDownstream ? {} : {
      buildings: [],
      spaces: [],
      obstacles: [],
      sunAnalysis: null,
      results: null,
      selectedSpaceId: null,
      selectedKit: null,
      maxVisitedStep: 1,
    }),
  });

  // Update UI
  document.getElementById('location-name').textContent = displayName;
  document.getElementById('location-coords').textContent = `${lat.toFixed(5)}°N, ${Math.abs(lng).toFixed(5)}°${lng >= 0 ? 'E' : 'W'}`;
  document.getElementById('location-info')?.classList.remove('hidden');
  document.getElementById('btn-next-location').disabled = false;
  updateLocationGuide();

  // Update marker
  if (marker) marker.remove();
  
  const el = document.createElement('div');
  el.style.cssText = 'width: 30px; height: 30px; background: var(--accent); border-radius: 50%; border: 3px solid white; box-shadow: 0 0 20px rgba(245,158,11,0.5); cursor: pointer;';
  
  marker = new mapRuntime.maplibregl.Marker({ element: el })
    .setLngLat([lng, lat])
    .addTo(map);

  // Fly to location
  map.flyTo({
    center: [lng, lat],
    zoom: 17,
    pitch: 50,
    bearing: -20,
    duration: 2000,
    essential: true,
  });
}

function updateLocationGuide() {
  const hasLocation = Boolean(getState('location'));
  const summaryEl = document.getElementById('location-guide-summary');

  if (summaryEl) {
    summaryEl.textContent = hasLocation
      ? 'Property selected. If the pin is on the right home, continue to Site Setup.'
      : 'Search or click the map to choose the property you want us to assess.';
  }

  setGuideStatus('location-guide-search-status', hasLocation ? 'Done' : 'To do', hasLocation);
  setGuideStatus('location-guide-confirm-status', hasLocation ? 'Ready' : 'Waiting', hasLocation);
  setGuideStatus('location-guide-next-status', hasLocation ? 'Unlocked' : 'Locked', hasLocation);
}

function setGuideStatus(elementId, label, done = false) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.textContent = label;
  element.classList.toggle('is-done', done);
}

export function cleanup() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }

  searchAbortController?.abort();
  searchAbortController = null;
  searchRequestId = 0;

  if (outsideClickHandler) {
    document.removeEventListener('mousedown', outsideClickHandler);
    outsideClickHandler = null;
  }

  mapSession.destroy();
  map = null;
  marker = null;
}

function showLocationMapLoading(message) {
  const overlay = document.getElementById('location-map-loading');
  const text = document.getElementById('location-map-loading-text');
  if (text && message) {
    text.textContent = message;
  }
  if (overlay) {
    overlay.classList.remove('hidden');
  }
}

function hideLocationMapLoading() {
  document.getElementById('location-map-loading')?.classList.add('hidden');
}
