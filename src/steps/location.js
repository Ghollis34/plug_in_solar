import maplibregl from 'maplibre-gl';
import { getState, setState } from '../utils/state.js';
import { createStepMap } from '../utils/map-helpers.js';

let map = null;
let marker = null;
let searchTimeout = null;

export function render() {
  return `
    <div class="step-page">
      <div class="step-header">
        <h2 class="step-title">📍 Find Your Location</h2>
        <p class="step-subtitle">Search your UK postcode or address to see your property in 3D</p>
      </div>

      <div class="step-body full-width">
        <div class="map-container" id="location-map"></div>

        <div class="map-overlay-panel">
          <div class="form-group mb-md">
            <label class="form-label">Search postcode or address</label>
            <div class="search-wrapper">
              <span class="search-icon">🔍</span>
              <input type="text" class="form-input" id="location-search" 
                     placeholder="e.g. SW1A 1AA or 10 Downing Street" 
                     autocomplete="off" />
              <div class="search-results hidden" id="search-results"></div>
            </div>
          </div>

          <div id="location-info" class="hidden">
            <div class="card-flat" style="padding: 14px;">
              <div style="font-weight: 600; margin-bottom: 4px;" id="location-name"></div>
              <div style="font-size: 0.8rem; color: var(--text-muted);" id="location-coords"></div>
            </div>
          </div>

          <div class="disclaimer mt-md">
            <span class="disclaimer-icon">ℹ️</span>
            <span>Use the mouse to tilt the map (right-click drag) and see buildings in 3D. Scroll to zoom in.</span>
          </div>
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-location">← Back</button>
        <button class="btn btn-primary" id="btn-next-location" disabled>
          Continue →
        </button>
      </div>
    </div>
  `;
}

export function init() {
  initMap();
  initSearch();

  document.getElementById('btn-back-location')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-location')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });

  // Restore saved location or clear stale input
  const saved = getState('location');
  const searchInput = document.getElementById('location-search');
  if (saved) {
    setTimeout(() => {
      setLocation(saved.lat, saved.lng, saved.displayName);
      if (searchInput) searchInput.value = saved.displayName || '';
    }, 500);
  } else if (searchInput) {
    searchInput.value = '';
  }
}

function initMap() {
  map = createStepMap({
    container: 'location-map',
    center: [-1.5, 53.0], // Centre of UK
    zoom: 6,
    pitch: 0,
    bearing: 0,
    maxBounds: [[-12, 49], [4, 61]], // UK bounds
  });

  // Click on map to set location
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
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      resultsEl?.classList.add('hidden');
    }
  });
}

async function searchPlaces(query) {
  const resultsEl = document.getElementById('search-results');
  
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
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();

    if (data.length === 0) {
      resultsEl.innerHTML = '<div class="search-result-item" style="color: var(--text-muted);">No results found</div>';
      resultsEl.classList.remove('hidden');
      return;
    }

    resultsEl.innerHTML = data.map((place, i) => {
      const safeName = place.display_name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `
        <div class="search-result-item" data-idx="${i}">
          ${place.display_name}
        </div>
      `;
    }).join('');

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
    console.error('Search failed:', err);
  }
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
      headers: { 'Accept-Language': 'en' }
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

function setLocation(lat, lng, displayName) {
  // Update state
  setState({
    location: { lat, lng, displayName }
  });

  // Update UI
  document.getElementById('location-name').textContent = displayName;
  document.getElementById('location-coords').textContent = `${lat.toFixed(5)}°N, ${Math.abs(lng).toFixed(5)}°${lng >= 0 ? 'E' : 'W'}`;
  document.getElementById('location-info')?.classList.remove('hidden');
  document.getElementById('btn-next-location').disabled = false;

  // Update marker
  if (marker) marker.remove();
  
  const el = document.createElement('div');
  el.style.cssText = 'width: 30px; height: 30px; background: var(--accent); border-radius: 50%; border: 3px solid white; box-shadow: 0 0 20px rgba(245,158,11,0.5); cursor: pointer;';
  
  marker = new maplibregl.Marker({ element: el })
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

export function cleanup() {
  if (map) {
    map.remove();
    map = null;
  }
  marker = null;
}
