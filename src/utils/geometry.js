const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_LONG = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];

export function normalizeDegrees(deg = 0) {
  return ((deg % 360) + 360) % 360;
}

export function degreesToCompass(deg = 0, format = 'short') {
  const labels = format === 'long' ? COMPASS_LONG : COMPASS_SHORT;
  const idx = Math.round(normalizeDegrees(deg) / 45) % 8;
  return labels[idx];
}

export function compassToDegrees(compass) {
  const normalized = String(compass || '').trim().toUpperCase();
  const idx = COMPASS_SHORT.indexOf(normalized);
  return idx === -1 ? null : idx * 45;
}

export function bearingToVector(bearingDeg) {
  const rad = normalizeDegrees(bearingDeg) * Math.PI / 180;
  return {
    dx: Math.sin(rad),
    dy: Math.cos(rad),
  };
}

export function latLngToMeters(lat1, lng1, lat2, lng2) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat1 * Math.PI / 180);

  return {
    dx: (lng2 - lng1) * mPerDegLng,
    dy: (lat2 - lat1) * mPerDegLat,
  };
}

export function metersToLatLng(lat, lng, dx, dy) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);

  return {
    lat: lat + (dy / mPerDegLat),
    lng: lng + (dx / mPerDegLng),
  };
}

export function getRectangleCorners(centerLat, centerLng, widthM, depthM, facingDeg) {
  const front = bearingToVector(facingDeg);
  const right = bearingToVector(facingDeg + 90);
  const halfWidth = widthM / 2;
  const halfDepth = depthM / 2;

  const frontDx = front.dx * halfDepth;
  const frontDy = front.dy * halfDepth;
  const rightDx = right.dx * halfWidth;
  const rightDy = right.dy * halfWidth;

  const cornersMeters = [
    { dx: frontDx - rightDx, dy: frontDy - rightDy },
    { dx: frontDx + rightDx, dy: frontDy + rightDy },
    { dx: -frontDx + rightDx, dy: -frontDy + rightDy },
    { dx: -frontDx - rightDx, dy: -frontDy - rightDy },
  ];

  return cornersMeters.map(({ dx, dy }) => metersToLatLng(centerLat, centerLng, dx, dy));
}

export function getRectangleRing(centerLat, centerLng, widthM, depthM, facingDeg) {
  const corners = getRectangleCorners(centerLat, centerLng, widthM, depthM, facingDeg);
  return [...corners, corners[0]];
}

export function getBearingBetweenPoints(fromLat, fromLng, toLat, toLng) {
  const { dx, dy } = latLngToMeters(fromLat, fromLng, toLat, toLng);
  const deg = Math.atan2(dx, dy) * 180 / Math.PI;
  return normalizeDegrees(deg);
}

export function projectPointToMeters(originLat, originLng, lat, lng) {
  return latLngToMeters(originLat, originLng, lat, lng);
}

export function pointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) inside = !inside;
  }

  return inside;
}

export function distancePointToSegment(point, start, end) {
  const segDx = end.x - start.x;
  const segDy = end.y - start.y;
  const segLenSq = (segDx ** 2) + (segDy ** 2);

  if (segLenSq === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  let t = ((point.x - start.x) * segDx + (point.y - start.y) * segDy) / segLenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = start.x + (t * segDx);
  const projY = start.y + (t * segDy);

  return Math.hypot(point.x - projX, point.y - projY);
}

export function convexHull(points) {
  if (points.length <= 3) return [...points];

  const sorted = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => ((a.x - o.x) * (b.y - o.y)) - ((a.y - o.y) * (b.x - o.x));

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();

  return [...lower, ...upper];
}
