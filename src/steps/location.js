import { getState, setState } from '../utils/state.js';
import { createMapStepSession } from '../utils/map-step-session.js';
import { setupMobileControlSheet } from '../utils/mobile-control-sheet.js';

let map = null;
let marker = null;
let searchTimeout = null;
let searchAbortController = null;
let searchRequestId = 0;
let outsideClickHandler = null;
let mapRuntime = null;
let locationControlSheet = null;

const mapSession = createMapStepSession();

export function render() {
  return `
    <div class="step-page step-page-map has-mobile-map-toggle">
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
                  <span>Type a postcode/address. If house numbers are missing, use the postcode result then tap the exact roof on the map.</span>
                </div>
                <span class="task-guide-status" id="location-guide-search-status">To do</span>
              </div>
              <div class="task-guide-item">
                <span class="task-guide-index">2</span>
                <div class="task-guide-copy">
                  <strong>Check the pin is on the right home</strong>
                  <span>Check the marker. If it picked the wrong home, tap the correct roof or press Change.</span>
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
              <div class="location-selection-actions">
                <span class="location-selection-status">Confirmed</span>
                <button type="button" class="btn btn-sm btn-secondary" id="btn-clear-location">Change</button>
              </div>
            </div>
            <div class="location-selection-coords" id="location-coords"></div>
          </div>

          <div class="disclaimer mt-md">
            <span class="disclaimer-icon">ℹ️</span>
            <span>Postcode search may only find the street or postcode centre. Tap the exact building on the satellite map to move the pin before continuing.</span>
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
  initLocationControls();
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
        setLocation(saved, undefined, undefined, { preserveDownstream: true });
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

  document.getElementById('btn-clear-location')?.addEventListener('click', () => {
    clearLocationSelection();
  });
}

function initLocationControls() {
  locationControlSheet = setupMobileControlSheet({
    onToggle: () => queueLocationMapResize(),
  });
}

function queueLocationMapResize() {
  const activeMap = map;
  if (!activeMap) return;

  window.requestAnimationFrame(() => {
    try {
      activeMap?.resize?.();
    } catch (error) {
      console.warn('Unable to resize location map after controls sheet change:', error);
    }

    window.requestAnimationFrame(() => {
      try {
        activeMap?.resize?.();
      } catch (error) {
        console.warn('Unable to settle location map after controls sheet change:', error);
      }
    });
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
    const suggestions = [];
    const postcodeSuggestion = await lookupPostcodeSuggestion(query, searchAbortController.signal);
    if (postcodeSuggestion) {
      suggestions.push(postcodeSuggestion);
    }

    // Use Nominatim for free geocoding (UK bounded). It is not a complete house-number
    // database, so postcode.io above gives a reliable fallback instead of silently
    // selecting a random nearby house.
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '8',
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

    data.forEach((place) => {
      suggestions.push({
        label: place.display_name,
        helper: place.type === 'house' || place.addresstype === 'house'
          ? 'Address match'
          : 'Map search match — check the pin before continuing',
        location: createLocationFromPlace(place),
      });
    });

    if (suggestions.length === 0) {
      resultsEl.replaceChildren(createSearchResultMessage('No address found. Try the postcode, then tap the exact building on the map.'));
      resultsEl.classList.remove('hidden');
      return;
    }

    const fragment = document.createDocumentFragment();
    suggestions.forEach((suggestion, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'search-result-item search-result-button';
      item.dataset.idx = String(i);
      item.innerHTML = `<strong>${escapeTextForLocation(suggestion.label)}</strong><span>${escapeTextForLocation(suggestion.helper)}</span>`;
      fragment.appendChild(item);
    });

    resultsEl.replaceChildren(fragment);
    resultsEl.classList.remove('hidden');

    resultsEl.querySelectorAll('.search-result-item[data-idx]').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(item.dataset.idx);
        const suggestion = suggestions[idx];
        if (!suggestion?.location) return;
        setLocation(suggestion.location);
        resultsEl.classList.add('hidden');
        document.getElementById('location-search').value = suggestion.location.displayName;
      });
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return;
    }
    console.error('Search failed:', err);
    resultsEl?.replaceChildren(createSearchResultMessage('Search failed. You can still tap the property directly on the map.'));
    resultsEl?.classList.remove('hidden');
  }
}

async function lookupPostcodeSuggestion(query, signal) {
  const postcode = normalizeUkPostcode(query);
  if (!postcode) return null;

  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      signal,
      referrerPolicy: 'no-referrer',
    });

    if (!res.ok) return null;
    const payload = await res.json();
    const result = payload?.result;
    if (!result || !Number.isFinite(Number(result.latitude)) || !Number.isFinite(Number(result.longitude))) {
      return null;
    }

    const outward = [result.admin_district, result.region].filter(Boolean).join(', ');
    const displayName = `${result.postcode} postcode area${outward ? ` · ${outward}` : ''}`;
    return {
      label: displayName,
      helper: 'Reliable postcode centre — then tap your exact roof if the pin is not on the house',
      location: createLocationFromPlace({
        lat: result.latitude,
        lon: result.longitude,
        display_name: displayName,
        address: {
          postcode: result.postcode,
          town: result.admin_district,
          state: result.region,
          country: 'United Kingdom',
        },
      }),
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}

function normalizeUkPostcode(query) {
  const compact = String(query || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return match ? `${match[1]} ${match[2]}` : null;
}

function escapeTextForLocation(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    const location = createLocationFromPlace({
      lat,
      lon: lng,
      display_name: data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      address: data.address,
    });
    setLocation(location);
    document.getElementById('location-search').value = location.displayName;
  } catch (err) {
    // Still set location even if reverse geocode fails
    setLocation(createLocationFromPlace({
      lat,
      lon: lng,
      display_name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    }));
  }
}

function setLocation(locationOrLat, lng, displayName, options = {}) {
  const preserveDownstream = options.preserveDownstream === true;
  const location = typeof locationOrLat === 'object' && locationOrLat
    ? locationOrLat
    : createLocationFromPlace({ lat: locationOrLat, lon: lng, display_name: displayName });
  const { lat, lng: resolvedLng, displayName: resolvedDisplayName, postcode } = location;

  // Update state
  setState({
    location,
    ...(preserveDownstream ? {} : {
      buildings: [],
      spaces: [],
      obstacles: [],
      sunAnalysis: null,
      results: null,
      electricityPricePence: null,
      selectedSpaceId: null,
      selectedKit: null,
      maxVisitedStep: 1,
    }),
  });

  // Update UI
  document.getElementById('location-name').textContent = resolvedDisplayName;
  document.getElementById('location-coords').textContent = `${postcode ? `${postcode} · ` : ''}${lat.toFixed(5)}°N, ${Math.abs(resolvedLng).toFixed(5)}°${resolvedLng >= 0 ? 'E' : 'W'}`;
  document.getElementById('location-info')?.classList.remove('hidden');
  document.getElementById('btn-next-location').disabled = false;
  updateLocationGuide();

  // Update marker
  if (marker) marker.remove();
  
  const el = document.createElement('div');
  el.style.cssText = 'width: 30px; height: 30px; background: var(--accent); border-radius: 50%; border: 3px solid white; box-shadow: 0 0 20px rgba(245,158,11,0.5); cursor: pointer;';
  
  marker = new mapRuntime.maplibregl.Marker({ element: el })
    .setLngLat([resolvedLng, lat])
    .addTo(map);

  // Fly to location
  map.flyTo({
    center: [resolvedLng, lat],
    zoom: 17,
    pitch: 50,
    bearing: -20,
    duration: 2000,
    essential: true,
  });
}


function clearLocationSelection() {
  setState({
    location: null,
    buildings: [],
    spaces: [],
    obstacles: [],
    sunAnalysis: null,
    results: null,
    electricityPricePence: null,
    selectedSpaceId: null,
    selectedKit: null,
    maxVisitedStep: 1,
  });

  marker?.remove?.();
  marker = null;
  document.getElementById('location-info')?.classList.add('hidden');
  const searchInput = document.getElementById('location-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  const nextButton = document.getElementById('btn-next-location');
  if (nextButton) nextButton.disabled = true;
  updateLocationGuide();
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
  locationControlSheet?.destroy();
  locationControlSheet = null;
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

function createLocationFromPlace(place = {}) {
  const address = place.address || {};
  const lat = Number(place.lat);
  const lng = Number(place.lon);

  return {
    lat,
    lng,
    displayName: place.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    postcode: address.postcode || '',
    city: address.city || address.town || address.village || address.hamlet || address.suburb || '',
    county: address.county || '',
    stateDistrict: address.state_district || address.state || address.region || '',
    country: address.country || '',
  };
}
