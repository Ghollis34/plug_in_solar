import { normalizeDegrees, metersToLatLng } from './geometry.js';
import { formatObstacleLabel } from './site-formatters.js';

export function rotateShedById(obstacles, obstacleId, deltaDeg) {
  return (obstacles || []).map((obstacle) => {
    if (obstacle.id !== obstacleId || obstacle.type !== 'shed') {
      return obstacle;
    }

    return {
      ...obstacle,
      rotationDeg: normalizeDegrees((obstacle.rotationDeg || 0) + deltaDeg),
    };
  });
}

export function moveObstacle(obstacle, dx, dy) {
  if (!dx && !dy) return obstacle;

  if (obstacle.type === 'tree' || obstacle.type === 'shed') {
    const moved = metersToLatLng(obstacle.lat, obstacle.lng, dx, dy);
    return {
      ...obstacle,
      lat: moved.lat,
      lng: moved.lng,
    };
  }

  if (obstacle.type === 'fence' && obstacle.points?.length >= 2) {
    return {
      ...obstacle,
      points: obstacle.points.map((point) => metersToLatLng(point.lat, point.lng, dx, dy)),
    };
  }

  return obstacle;
}

export function moveObstacleById(obstacles, obstacleId, dx, dy) {
  return (obstacles || []).map((obstacle) => (
    obstacle.id === obstacleId ? moveObstacle(obstacle, dx, dy) : obstacle
  ));
}

export function getSelectedObstacleLabel(obstacles, selectedObstacleId) {
  const obstacle = (obstacles || []).find((entry) => entry.id === selectedObstacleId);
  if (!obstacle) return 'Obstacle';
  return formatObstacleLabel(obstacle).replace(/^[^\w]+/u, '').trim();
}
