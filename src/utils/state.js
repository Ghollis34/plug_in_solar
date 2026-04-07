/**
 * Simple reactive state store with event emitting and localStorage persistence
 */

const STORAGE_KEY = 'solarspot_state';

const defaultState = {
  currentStep: 0,
  location: null,       // { lat, lng, displayName, postcode }
  buildings: [],        // [{ id, floors, pitched, height, lngLat }]
  spaces: [],           // [{ id, name, type, polygon, orientation, tilt, sunHours }]
  sunAnalysis: null,    // { bestSpaceId, scores: [...], date }
  selectedKit: null,    // kit object from kits.json
  results: null,        // { annualKwh, annualSavings, paybackYears, ... }
};

let state = { ...defaultState };
const listeners = new Map();

/** Load state from localStorage */
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = { ...defaultState, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load saved state:', e);
  }
}

/** Save state to localStorage */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

/** Get a value from state */
export function getState(key) {
  if (key) return state[key];
  return { ...state };
}

/** Set state values and notify listeners */
export function setState(updates) {
  const changedKeys = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (state[key] !== value) {
      state[key] = value;
      changedKeys.push(key);
    }
  }

  if (changedKeys.length > 0) {
    saveState();
    changedKeys.forEach(key => {
      const keyListeners = listeners.get(key) || [];
      keyListeners.forEach(fn => fn(state[key], key));
    });
    // Also fire wildcard listeners
    const wildcardListeners = listeners.get('*') || [];
    wildcardListeners.forEach(fn => fn(state, changedKeys));
  }
}

/** Subscribe to state changes */
export function subscribe(key, callback) {
  if (!listeners.has(key)) {
    listeners.set(key, []);
  }
  listeners.get(key).push(callback);
  
  // Return unsubscribe function
  return () => {
    const arr = listeners.get(key);
    const idx = arr.indexOf(callback);
    if (idx > -1) arr.splice(idx, 1);
  };
}

/** Reset state to defaults */
export function resetState() {
  state = { ...defaultState };
  saveState();
  // Notify all listeners
  for (const [key, keyListeners] of listeners) {
    keyListeners.forEach(fn => fn(state[key], key));
  }
}

// Load saved state on init
loadState();
