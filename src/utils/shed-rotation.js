import { degreesToCompass } from './geometry.js';

const DEFAULT_CONFIG = {
  sliderId: 'shed-rotation-slider',
  chipsSelector: '[data-shed-rotation]',
  valueId: 'shed-rotation-value',
  noteId: 'shed-rotation-note',
};

export function setShedRotationValue(value, config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  const slider = document.getElementById(options.sliderId);
  if (slider) {
    slider.value = String(value);
  }
  syncShedRotationUI(options);
}

export function getShedRotationValue(config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  const value = parseInt(document.getElementById(options.sliderId)?.value || 0, 10);
  return Number.isFinite(value) ? value : 0;
}

export function syncShedRotationUI(config = {}) {
  const options = { ...DEFAULT_CONFIG, ...config };
  const rotation = getShedRotationValue(options);
  const valueEl = document.getElementById(options.valueId);
  const noteEl = document.getElementById(options.noteId);

  document.querySelectorAll(options.chipsSelector).forEach((chip) => {
    chip.classList.toggle('active', parseInt(chip.dataset.shedRotation || '', 10) === rotation);
  });

  if (valueEl) {
    valueEl.textContent = `${degreesToCompass(rotation, 'long')} (${rotation}°)`;
  }

  if (noteEl) {
    noteEl.textContent = `Shed front set to ${degreesToCompass(rotation, 'long')}. Place it on the map when the direction looks right.`;
  }
}
