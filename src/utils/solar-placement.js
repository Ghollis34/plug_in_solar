const DEFAULT_FACING = 180;
const DEFAULT_TILT = 35;

export function getAnnualSolarRecommendation(lat) {
  return {
    orientation: getRecommendedSolarFacing(lat),
    tilt: getRecommendedSolarTilt(lat),
  };
}

export function getRecommendedSolarFacing(lat) {
  const numericLat = parseLatitude(lat);

  if (!Number.isFinite(numericLat)) {
    return DEFAULT_FACING;
  }

  return numericLat < 0 ? 0 : 180;
}

export function getRecommendedSolarTilt(lat) {
  const numericLat = Math.abs(parseLatitude(lat));

  if (!Number.isFinite(numericLat)) {
    return DEFAULT_TILT;
  }

  // Fixed annual tilt heuristic tuned for temperate latitudes and clamped for edge cases.
  const rawTilt = (numericLat * 0.76) + 3.1;
  return clamp(Math.round(rawTilt), 10, 50);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseLatitude(lat) {
  if (lat == null || lat === '') {
    return Number.NaN;
  }

  return Number(lat);
}
