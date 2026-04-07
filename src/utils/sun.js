import SunCalc from 'suncalc';
import {
  bearingToVector,
  convexHull,
  degreesToCompass,
  distancePointToSegment,
  getBearingBetweenPoints,
  getRectangleRing,
  metersToLatLng,
  pointInPolygon,
  projectPointToMeters,
} from './geometry.js';

const INTERVAL_MINUTES = 15;
const SUMMER_WEIGHT = [0.6, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7, 0.6];
const BUILDING_MOUNT_TYPES = new Set(['railing', 'wall', 'flat-roof']);

export function getSunPosition(date, lat, lng) {
  const pos = SunCalc.getPosition(date, lat, lng);
  return {
    altitude: pos.altitude,
    altitudeDeg: pos.altitude * (180 / Math.PI),
    azimuth: pos.azimuth,
    azimuthDeg: pos.azimuth * (180 / Math.PI) + 180,
  };
}

export function getSunTimes(date, lat, lng) {
  return SunCalc.getTimes(date, lat, lng);
}

export function getShadowLength(height, sunAltitude) {
  if (sunAltitude <= 0) return Infinity;
  return height / Math.tan(sunAltitude);
}

export function getShadowDirection(sunAzimuth) {
  let dirDeg = (sunAzimuth * (180 / Math.PI)) + 360;
  dirDeg = ((dirDeg % 360) + 360) % 360;
  return dirDeg;
}

export function getMapLightFromSun(date, lat, lng) {
  const pos = getSunPosition(date, lat, lng);
  const azimuthal = pos.azimuthDeg;
  const polar = 90 - pos.altitudeDeg;
  const intensity = Math.max(0, Math.min(1, pos.altitudeDeg / 60));

  let color;
  if (pos.altitudeDeg < 5) color = '#ff6b35';
  else if (pos.altitudeDeg < 15) color = '#ffaa55';
  else if (pos.altitudeDeg < 30) color = '#ffd699';
  else color = '#ffffff';

  return {
    anchor: 'map',
    position: [1.5, azimuthal, polar],
    intensity: Math.max(0.2, intensity),
    color,
    isSunUp: pos.altitudeDeg > 0,
  };
}

export function analyzeSpaceYear(lat, lng, space, buildings = [], obstacles = []) {
  const monthly = [];
  const year = new Date().getFullYear();

  const obstructionTotals = {
    building: 0,
    fence: 0,
    tree: 0,
    shed: 0,
  };

  const bucketTotals = {
    morning: { direct: 0, daylight: 0 },
    midday: { direct: 0, daylight: 0 },
    afternoon: { direct: 0, daylight: 0 },
  };

  let annualDirectMinutes = 0;
  let annualDaylightMinutes = 0;

  for (let month = 0; month < 12; month += 1) {
    const date = new Date(year, month, 15);
    const day = analyzeSpaceDay(date, lat, lng, space, buildings, obstacles);

    monthly.push({
      month: date.toLocaleString('en-GB', { month: 'short' }),
      hours: roundTo(day.hours, 1),
      shadowFactor: roundTo(day.shadowFactor, 2),
    });

    annualDirectMinutes += day.directSunMinutes * 30;
    annualDaylightMinutes += day.daylightMinutes * 30;

    Object.keys(obstructionTotals).forEach((type) => {
      obstructionTotals[type] += (day.obstructionMinutes[type] || 0) * 30;
    });

    Object.keys(bucketTotals).forEach((bucket) => {
      bucketTotals[bucket].direct += day.bucketTotals[bucket].direct * 30;
      bucketTotals[bucket].daylight += day.bucketTotals[bucket].daylight * 30;
    });
  }

  const avgDailyHours = monthly.reduce((sum, entry) => sum + entry.hours, 0) / monthly.length;
  const annualHours = monthly.reduce((sum, entry) => sum + (entry.hours * 30), 0);
  const shadowFactor = annualDaylightMinutes > 0 ? annualDirectMinutes / annualDaylightMinutes : 0;
  const confidence = getConfidence(buildings[0], obstacles);
  const uncertaintyMargin = getUncertaintyMargin(confidence);
  const relativeToBuilding = getRelativeToBuilding(space, buildings[0]);
  const breakdown = classifyBreakdown(bucketTotals);
  const obstructionSummary = Object.fromEntries(
    Object.entries(obstructionTotals).map(([type, minutes]) => [type, roundTo(minutes / 60, 1)])
  );
  const warnings = buildWarnings(relativeToBuilding, shadowFactor, obstructionSummary);
  const warningLevel = getWarningLevel(relativeToBuilding, shadowFactor);
  const weightedScore = monthly.reduce((sum, entry, idx) => sum + (entry.hours * SUMMER_WEIGHT[idx]), 0) / 12;

  return {
    ...space,
    monthly,
    avgDailyHours: roundTo(avgDailyHours, 1),
    annualHours: Math.round(annualHours),
    score: roundTo(weightedScore, 2),
    shadowFactor: roundTo(shadowFactor, 2),
    conservativeFactor: roundTo(clamp(shadowFactor - uncertaintyMargin, 0, 1), 2),
    optimisticFactor: roundTo(clamp(shadowFactor + uncertaintyMargin, 0, 1), 2),
    confidence,
    relativeToBuilding,
    relativeDirectionLabel: formatRelativeDirection(relativeToBuilding),
    warningLevel,
    warnings,
    breakdown,
    obstructionSummary,
  };
}

export function rankSpaces(lat, lng, spaces, buildings = [], obstacles = []) {
  const scored = spaces.map((space) => analyzeSpaceYear(lat, lng, space, buildings, obstacles));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function samplePlacementHeatmap(centerLat, centerLng, buildings = [], obstacles = [], options = {}) {
  const radiusM = options.radiusM ?? 16;
  const stepM = options.stepM ?? 4;
  const year = new Date().getFullYear();
  const sampleDates = [
    { date: new Date(year, 2, 15), weight: 0.8 },
    { date: new Date(year, 5, 21), weight: 1.1 },
    { date: new Date(year, 8, 15), weight: 0.9 },
    { date: new Date(year, 11, 15), weight: 0.6 },
  ];

  const features = [];

  for (let dy = -radiusM; dy <= radiusM; dy += stepM) {
    for (let dx = -radiusM; dx <= radiusM; dx += stepM) {
      const point = metersToLatLng(centerLat, centerLng, dx, dy);
      const sample = getGuideSample(point.lat, point.lng, buildings, obstacles, sampleDates);

      features.push({
        type: 'Feature',
        properties: {
          score: roundTo(sample.shadowFactor, 2),
          hours: roundTo(sample.avgHours, 1),
        },
        geometry: {
          type: 'Point',
          coordinates: [point.lng, point.lat],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

export function getShadowOverlayFeatures(date, lat, lng, buildings = [], obstacles = []) {
  const sunPos = getSunPosition(date, lat, lng);
  if (sunPos.altitudeDeg <= 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = [];

  buildings.forEach((building) => {
    const feature = buildBuildingShadowFeature(building, sunPos);
    if (feature) features.push(feature);
  });

  obstacles.forEach((obstacle) => {
    const feature = buildObstacleShadowFeature(obstacle, sunPos);
    if (feature) features.push(feature);
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

export function getDayPath(date, lat, lng, intervalMinutes = 15) {
  const times = getSunTimes(date, lat, lng);
  const positions = [];

  const start = new Date(times.sunrise);
  start.setMinutes(start.getMinutes() - 30);
  const end = new Date(times.sunset);
  end.setMinutes(end.getMinutes() + 30);

  const current = new Date(start);
  while (current <= end) {
    const pos = getSunPosition(current, lat, lng);
    positions.push({
      time: new Date(current),
      timeStr: current.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      ...pos,
    });
    current.setMinutes(current.getMinutes() + intervalMinutes);
  }

  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    solarNoon: times.solarNoon,
    positions,
  };
}

function analyzeSpaceDay(date, lat, lng, space, buildings, obstacles) {
  const times = getSunTimes(date, lat, lng);
  if (!times.sunrise || !times.sunset) {
    return createEmptyDayResult();
  }

  const obstructionMinutes = { building: 0, fence: 0, tree: 0, shed: 0 };
  const bucketTotals = {
    morning: { direct: 0, daylight: 0 },
    midday: { direct: 0, daylight: 0 },
    afternoon: { direct: 0, daylight: 0 },
  };

  let directSunMinutes = 0;
  let daylightMinutes = 0;
  const current = new Date(times.sunrise);

  while (current <= times.sunset) {
    const pos = getSunPosition(current, lat, lng);

    if (pos.altitudeDeg > 0) {
      const bucket = getDayBucket(current, times);
      const strongestBlock = getStrongestObstruction(space, pos, buildings, obstacles);
      const directFraction = 1 - strongestBlock.amount;

      daylightMinutes += INTERVAL_MINUTES;
      directSunMinutes += INTERVAL_MINUTES * directFraction;
      bucketTotals[bucket].daylight += INTERVAL_MINUTES;
      bucketTotals[bucket].direct += INTERVAL_MINUTES * directFraction;

      if (strongestBlock.type) {
        obstructionMinutes[strongestBlock.type] += INTERVAL_MINUTES * strongestBlock.amount;
      }
    }

    current.setMinutes(current.getMinutes() + INTERVAL_MINUTES);
  }

  return {
    hours: directSunMinutes / 60,
    directSunMinutes,
    daylightMinutes,
    shadowFactor: daylightMinutes > 0 ? directSunMinutes / daylightMinutes : 0,
    obstructionMinutes,
    bucketTotals,
  };
}

function getGuideSample(pointLat, pointLng, buildings, obstacles, sampleDates) {
  const space = {
    id: 'guide',
    type: 'ground',
    centerLat: pointLat,
    centerLng: pointLng,
  };

  let totalWeight = 0;
  let weightedFactor = 0;
  let weightedHours = 0;

  sampleDates.forEach(({ date, weight }) => {
    const day = analyzeSpaceDay(date, pointLat, pointLng, space, buildings, obstacles);
    totalWeight += weight;
    weightedFactor += day.shadowFactor * weight;
    weightedHours += day.hours * weight;
  });

  return {
    shadowFactor: totalWeight > 0 ? weightedFactor / totalWeight : 0,
    avgHours: totalWeight > 0 ? weightedHours / totalWeight : 0,
  };
}

function getStrongestObstruction(space, sunPos, buildings, obstacles) {
  let strongest = { amount: 0, type: null };

  buildings.forEach((building) => {
    const block = getBuildingBlock(space, building, sunPos);
    if (block.amount > strongest.amount) strongest = block;
  });

  obstacles.forEach((obstacle) => {
    const block = getObstacleBlock(space, obstacle, sunPos);
    if (block.amount > strongest.amount) strongest = block;
  });

  return strongest;
}

function getBuildingBlock(space, building, sunPos) {
  if (!Number.isFinite(building?.lat) || !Number.isFinite(building?.lng) || !Number.isFinite(building?.height)) {
    return { amount: 0, type: null };
  }

  const basePoints = getBuildingBasePoints(building);
  const basePolygon = basePoints.map((point) => {
    const projected = projectPointToMeters(space.centerLat, space.centerLng, point.lat, point.lng);
    return { x: projected.dx, y: projected.dy };
  });

  if (BUILDING_MOUNT_TYPES.has(space.type) && pointInPolygon({ x: 0, y: 0 }, basePolygon)) {
    return { amount: 0, type: null };
  }

  if (isPointInsideShadow(basePolygon, building.height, sunPos)) {
    return { amount: 1, type: 'building' };
  }

  return { amount: 0, type: null };
}

function getObstacleBlock(space, obstacle, sunPos) {
  if (obstacle.type === 'fence') {
    return getFenceBlock(space, obstacle, sunPos);
  }

  if (obstacle.type === 'tree') {
    return getTreeBlock(space, obstacle, sunPos);
  }

  if (obstacle.type === 'shed') {
    return getShedBlock(space, obstacle, sunPos);
  }

  return { amount: 0, type: null };
}

function getFenceBlock(space, obstacle, sunPos) {
  if (!obstacle.points?.length || obstacle.points.length < 2) {
    return { amount: 0, type: null };
  }

  const shadowLength = getShadowLength(obstacle.heightM || 1.8, sunPos.altitude);
  if (!Number.isFinite(shadowLength) || shadowLength <= 0) {
    return { amount: 0, type: null };
  }

  const shadowBearing = getShadowDirection(sunPos.azimuth);
  const shadowVector = bearingToVector(shadowBearing);
  const translate = {
    x: shadowVector.dx * shadowLength,
    y: shadowVector.dy * shadowLength,
  };

  const start = projectPointToMeters(space.centerLat, space.centerLng, obstacle.points[0].lat, obstacle.points[0].lng);
  const end = projectPointToMeters(space.centerLat, space.centerLng, obstacle.points[1].lat, obstacle.points[1].lng);
  const quad = [
    { x: start.dx, y: start.dy },
    { x: end.dx, y: end.dy },
    { x: end.dx + translate.x, y: end.dy + translate.y },
    { x: start.dx + translate.x, y: start.dy + translate.y },
  ];

  return pointInPolygon({ x: 0, y: 0 }, quad)
    ? { amount: 1, type: 'fence' }
    : { amount: 0, type: null };
}

function getTreeBlock(space, obstacle, sunPos) {
  if (!Number.isFinite(obstacle.lat) || !Number.isFinite(obstacle.lng)) {
    return { amount: 0, type: null };
  }

  const shadowLength = getShadowLength(obstacle.heightM || 5, sunPos.altitude);
  if (!Number.isFinite(shadowLength) || shadowLength <= 0) {
    return { amount: 0, type: null };
  }

  const shadowBearing = getShadowDirection(sunPos.azimuth);
  const shadowVector = bearingToVector(shadowBearing);
  const start = projectPointToMeters(space.centerLat, space.centerLng, obstacle.lat, obstacle.lng);
  const end = {
    x: start.dx + (shadowVector.dx * shadowLength),
    y: start.dy + (shadowVector.dy * shadowLength),
  };

  const distance = distancePointToSegment({ x: 0, y: 0 }, { x: start.dx, y: start.dy }, end);
  const canopyRadius = obstacle.canopyRadiusM || 3;

  return distance <= canopyRadius
    ? { amount: 0.65, type: 'tree' }
    : { amount: 0, type: null };
}

function getShedBlock(space, obstacle, sunPos) {
  if (!Number.isFinite(obstacle.lat) || !Number.isFinite(obstacle.lng)) {
    return { amount: 0, type: null };
  }

  const ring = getRectangleRing(
    obstacle.lat,
    obstacle.lng,
    obstacle.widthM || 3,
    obstacle.depthM || 2,
    obstacle.rotationDeg || 0
  );
  const basePolygon = ring.slice(0, -1).map((point) => {
    const projected = projectPointToMeters(space.centerLat, space.centerLng, point.lat, point.lng);
    return { x: projected.dx, y: projected.dy };
  });

  return isPointInsideShadow(basePolygon, obstacle.heightM || 2.5, sunPos)
    ? { amount: 1, type: 'shed' }
    : { amount: 0, type: null };
}

function buildBuildingShadowFeature(building, sunPos) {
  if (!Number.isFinite(building?.lat) || !Number.isFinite(building?.lng) || !Number.isFinite(building?.height)) {
    return null;
  }

  const basePoints = getBuildingBasePoints(building);

  return buildPolygonShadowFeature(
    building.lat,
    building.lng,
    basePoints,
    building.height,
    sunPos,
    'building'
  );
}

function buildObstacleShadowFeature(obstacle, sunPos) {
  if (obstacle.type === 'fence') {
    return buildFenceShadowFeature(obstacle, sunPos);
  }

  if (obstacle.type === 'tree') {
    return buildTreeShadowFeature(obstacle, sunPos);
  }

  if (obstacle.type === 'shed') {
    return buildShedShadowFeature(obstacle, sunPos);
  }

  return null;
}

function buildFenceShadowFeature(obstacle, sunPos) {
  if (!obstacle.points?.length || obstacle.points.length < 2) return null;

  const shadowLength = getShadowLength(obstacle.heightM || 1.8, sunPos.altitude);
  if (!Number.isFinite(shadowLength) || shadowLength <= 0) return null;

  const origin = obstacle.points[0];
  const endMeters = projectPointToMeters(origin.lat, origin.lng, obstacle.points[1].lat, obstacle.points[1].lng);
  const shadowBearing = getShadowDirection(sunPos.azimuth);
  const shadowVector = bearingToVector(shadowBearing);
  const translate = {
    x: shadowVector.dx * shadowLength,
    y: shadowVector.dy * shadowLength,
  };

  const polygonMeters = [
    { x: 0, y: 0 },
    { x: endMeters.dx, y: endMeters.dy },
    { x: endMeters.dx + translate.x, y: endMeters.dy + translate.y },
    { x: translate.x, y: translate.y },
  ];

  return {
    type: 'Feature',
    properties: { type: 'fence' },
    geometry: {
      type: 'Polygon',
      coordinates: [[...polygonMeters, polygonMeters[0]].map((point) => {
        const latLng = metersToLatLng(origin.lat, origin.lng, point.x, point.y);
        return [latLng.lng, latLng.lat];
      })],
    },
  };
}

function buildTreeShadowFeature(obstacle, sunPos) {
  if (!Number.isFinite(obstacle?.lat) || !Number.isFinite(obstacle?.lng)) return null;

  const shadowLength = getShadowLength(obstacle.heightM || 5, sunPos.altitude);
  if (!Number.isFinite(shadowLength) || shadowLength <= 0) return null;

  const shadowBearing = getShadowDirection(sunPos.azimuth);
  const shadowVector = bearingToVector(shadowBearing);
  const perpVector = bearingToVector(shadowBearing + 90);
  const radius = obstacle.canopyRadiusM || 3;
  const end = {
    x: shadowVector.dx * shadowLength,
    y: shadowVector.dy * shadowLength,
  };
  const polygonMeters = [
    { x: perpVector.dx * radius, y: perpVector.dy * radius },
    { x: -perpVector.dx * radius, y: -perpVector.dy * radius },
    { x: end.x - (perpVector.dx * radius), y: end.y - (perpVector.dy * radius) },
    { x: end.x + (perpVector.dx * radius), y: end.y + (perpVector.dy * radius) },
  ];

  return {
    type: 'Feature',
    properties: { type: 'tree' },
    geometry: {
      type: 'Polygon',
      coordinates: [[...polygonMeters, polygonMeters[0]].map((point) => {
        const latLng = metersToLatLng(obstacle.lat, obstacle.lng, point.x, point.y);
        return [latLng.lng, latLng.lat];
      })],
    },
  };
}

function buildShedShadowFeature(obstacle, sunPos) {
  if (!Number.isFinite(obstacle?.lat) || !Number.isFinite(obstacle?.lng)) return null;

  const ring = getRectangleRing(
    obstacle.lat,
    obstacle.lng,
    obstacle.widthM || 3,
    obstacle.depthM || 2,
    obstacle.rotationDeg || 0
  );

  return buildPolygonShadowFeature(
    obstacle.lat,
    obstacle.lng,
    ring.slice(0, -1),
    obstacle.heightM || 2.5,
    sunPos,
    'shed'
  );
}

function buildPolygonShadowFeature(originLat, originLng, baseLatLngPoints, heightM, sunPos, type) {
  const basePolygon = baseLatLngPoints.map((point) => {
    const projected = projectPointToMeters(originLat, originLng, point.lat, point.lng);
    return { x: projected.dx, y: projected.dy };
  });
  const hull = getShadowHull(basePolygon, heightM, sunPos);
  if (!hull) return null;

  return {
    type: 'Feature',
    properties: { type },
    geometry: {
      type: 'Polygon',
      coordinates: [[...hull, hull[0]].map((point) => {
        const latLng = metersToLatLng(originLat, originLng, point.x, point.y);
        return [latLng.lng, latLng.lat];
      })],
    },
  };
}

function isPointInsideShadow(basePolygon, heightM, sunPos) {
  const hull = getShadowHull(basePolygon, heightM, sunPos);
  if (!hull) return false;
  return pointInPolygon({ x: 0, y: 0 }, hull);
}

function getShadowHull(basePolygon, heightM, sunPos) {
  const shadowLength = getShadowLength(heightM, sunPos.altitude);
  if (!Number.isFinite(shadowLength) || shadowLength <= 0) {
    return null;
  }

  const shadowBearing = getShadowDirection(sunPos.azimuth);
  const shadowVector = bearingToVector(shadowBearing);
  const translated = basePolygon.map((point) => ({
    x: point.x + (shadowVector.dx * shadowLength),
    y: point.y + (shadowVector.dy * shadowLength),
  }));

  return convexHull([...basePolygon, ...translated]);
}

function getBuildingBasePoints(building) {
  if (building.footprint?.length >= 3) {
    return building.footprint;
  }

  const widthM = building.frontDoorFacing == null
    ? Math.max(building.widthM || 5, building.depthM || 9)
    : (building.widthM || 5);
  const depthM = building.frontDoorFacing == null
    ? Math.max(building.widthM || 5, building.depthM || 9)
    : (building.depthM || 9);
  const facingDeg = building.frontDoorFacing == null ? 0 : building.frontDoorFacing;
  const ring = getRectangleRing(building.lat, building.lng, widthM, depthM, facingDeg);
  return ring.slice(0, -1);
}

function createEmptyDayResult() {
  return {
    hours: 0,
    directSunMinutes: 0,
    daylightMinutes: 0,
    shadowFactor: 0,
    obstructionMinutes: { building: 0, fence: 0, tree: 0, shed: 0 },
    bucketTotals: {
      morning: { direct: 0, daylight: 0 },
      midday: { direct: 0, daylight: 0 },
      afternoon: { direct: 0, daylight: 0 },
    },
  };
}

function getDayBucket(currentTime, times) {
  const daylightSpan = times.sunset.getTime() - times.sunrise.getTime();
  const elapsed = currentTime.getTime() - times.sunrise.getTime();
  const fraction = daylightSpan > 0 ? elapsed / daylightSpan : 0;

  if (fraction < 0.33) return 'morning';
  if (fraction < 0.66) return 'midday';
  return 'afternoon';
}

function classifyBreakdown(bucketTotals) {
  return Object.fromEntries(
    Object.entries(bucketTotals).map(([bucket, values]) => {
      const ratio = values.daylight > 0 ? values.direct / values.daylight : 0;
      let label = 'shade';
      if (ratio >= 0.72) label = 'sun';
      else if (ratio >= 0.42) label = 'mixed';
      return [bucket, label];
    })
  );
}

function getConfidence(building, obstacles) {
  const hasOrientation = building?.frontDoorFacing != null;
  const hasObstacles = obstacles.length > 0;

  if (hasOrientation && hasObstacles) return 'high';
  if (hasOrientation || hasObstacles) return 'medium';
  return 'low';
}

function getUncertaintyMargin(confidence) {
  if (confidence === 'high') return 0.08;
  if (confidence === 'medium') return 0.14;
  return 0.22;
}

function getRelativeToBuilding(space, building) {
  if (!Number.isFinite(building?.lat) || !Number.isFinite(building?.lng)) return 'unknown';

  const bearing = getBearingBetweenPoints(building.lat, building.lng, space.centerLat, space.centerLng);
  const { dx, dy } = projectPointToMeters(building.lat, building.lng, space.centerLat, space.centerLng);
  const distance = Math.hypot(dx, dy);
  const footprintRadius = Math.max(building.widthM || 5, building.depthM || 9) / 2;

  if (distance <= footprintRadius && BUILDING_MOUNT_TYPES.has(space.type)) {
    return 'on-building';
  }

  return degreesToCompass(bearing, 'long').toLowerCase();
}

function formatRelativeDirection(relativeToBuilding) {
  if (relativeToBuilding === 'on-building') return 'On the building';
  if (relativeToBuilding === 'unknown') return 'Relative position unknown';
  return `${relativeToBuilding.charAt(0).toUpperCase()}${relativeToBuilding.slice(1)} of building`;
}

function buildWarnings(relativeToBuilding, shadowFactor, obstructionSummary) {
  const warnings = [];

  if (relativeToBuilding === 'north') {
    warnings.push('North of building - heavy shading expected');
  } else if (relativeToBuilding === 'north-east' || relativeToBuilding === 'north-west') {
    warnings.push('North side of building - long seasonal shadows likely');
  } else if (relativeToBuilding === 'east') {
    warnings.push('East of building - limited afternoon sun');
  } else if (relativeToBuilding === 'west') {
    warnings.push('West of building - limited morning sun');
  } else if (relativeToBuilding === 'south') {
    warnings.push('South of building - strongest direct sun');
  } else if (relativeToBuilding === 'on-building') {
    warnings.push('Mounted on the building - roof or wall orientation matters more than garden shading');
  }

  const dominantObstacle = Object.entries(obstructionSummary)
    .filter(([, hours]) => hours > 0)
    .sort((a, b) => b[1] - a[1])[0];

  if (dominantObstacle?.[0] === 'fence') {
    warnings.push('Fence shading is materially affecting this spot');
  } else if (dominantObstacle?.[0] === 'tree') {
    warnings.push('Tree shading is partial and more uncertain than solid structures');
  } else if (dominantObstacle?.[0] === 'shed') {
    warnings.push('Small structure shading is materially affecting this spot');
  }

  if (warnings.length === 0) {
    if (shadowFactor < 0.45) warnings.push('Direct sun is limited across the year');
    else if (shadowFactor > 0.8) warnings.push('Very open position with strong direct sun');
  }

  return warnings.slice(0, 2);
}

function getWarningLevel(relativeToBuilding, shadowFactor) {
  if (relativeToBuilding === 'north' || relativeToBuilding === 'north-east' || relativeToBuilding === 'north-west' || shadowFactor < 0.45) {
    return 'high';
  }

  if (relativeToBuilding === 'east' || relativeToBuilding === 'west' || shadowFactor < 0.7) {
    return 'medium';
  }

  return 'low';
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
