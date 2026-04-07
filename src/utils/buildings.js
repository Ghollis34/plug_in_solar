import config from '../data/config.json';

/**
 * Calculate building height from user inputs
 * @param {number} floors - Number of floors (1-5)
 * @param {boolean} pitched - Whether the building has a pitched roof
 * @returns {number} Estimated height in metres
 */
export function calcHeight(floors, pitched = false) {
  const baseHeight = floors * config.floorHeight;
  return pitched ? baseHeight + config.pitchedRoofAddition : baseHeight;
}

/**
 * Format height for display
 */
export function formatHeight(height) {
  return `${height.toFixed(1)}m`;
}

/**
 * Get a description of the building
 */
export function getBuildingDescription(floors, pitched) {
  const h = calcHeight(floors, pitched);
  const roofType = pitched ? 'pitched roof' : 'flat roof';
  return `${floors} floor${floors > 1 ? 's' : ''}, ${roofType} (~${formatHeight(h)})`;
}

/**
 * Default building heights for common UK building types
 */
export const buildingPresets = [
  { label: 'Bungalow', floors: 1, pitched: true, icon: '🏠' },
  { label: '2-Storey House', floors: 2, pitched: true, icon: '🏡' },
  { label: '3-Storey House', floors: 3, pitched: true, icon: '🏘️' },
  { label: 'Low-Rise Flat', floors: 3, pitched: false, icon: '🏢' },
  { label: 'Mid-Rise Flat', floors: 5, pitched: false, icon: '🏬' },
  { label: 'Garden Shed', floors: 1, pitched: false, icon: '🏚️' },
];

/**
 * Validate floor input
 */
export function validateFloors(floors) {
  const n = parseInt(floors, 10);
  if (isNaN(n) || n < 1) return 1;
  if (n > 10) return 10;
  return n;
}
