import { degreesToCompass } from './geometry.js';

export function formatObstacleLabel(obstacle) {
  if (obstacle?.type === 'tree') return '🌳 Tree';
  if (obstacle?.type === 'shed') return '⬜ Shed / Wall';
  return '🟧 Fence';
}

export function formatObstacleDetails(obstacle) {
  if (obstacle?.type === 'tree') {
    return `${obstacle.heightM}m high · ${obstacle.canopyRadiusM}m canopy radius`;
  }

  if (obstacle?.type === 'shed') {
    const facing = Math.round(obstacle.rotationDeg || 0);
    return `${obstacle.widthM}m × ${obstacle.depthM}m · ${obstacle.heightM}m high · facing ${degreesToCompass(obstacle.rotationDeg || 0, 'long')} (${facing}°)`;
  }

  return `${obstacle?.heightM}m high line`;
}
