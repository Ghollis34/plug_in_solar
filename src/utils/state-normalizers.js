import { normalizeDegrees } from './geometry.js';
import { getSpaceTypeInfo, OBSTACLE_TYPE_IDS, SPACE_TYPE_IDS } from './site-config.js';

export const MAX_STEP_INDEX = 6;

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,80}$/;
const SAFE_CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const SAFE_WARNING_LEVELS = new Set(['low', 'medium', 'high']);
const SAFE_BREAKDOWN_VALUES = new Set(['sun', 'mixed', 'shade']);
const SAFE_OBSTRUCTION_KEYS = new Set(['tree', 'fence', 'shed', 'building']);

export function normalizePersistedState(value, defaultState = {}) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const normalized = { ...defaultState, ...normalizeUpdates(value) };
  reconcileDerivedState(normalized, normalized, defaultState);
  return normalized;
}

export function normalizeUpdates(updates) {
  const normalized = {};

  for (const [key, value] of Object.entries(updates || {})) {
    normalized[key] = normalizeStateValue(key, value);
  }

  return normalized;
}

export function normalizeStateValue(key, value) {
  switch (key) {
    case 'currentStep':
      return normalizeStepIndex(value, 0);
    case 'maxVisitedStep':
      return normalizeStepIndex(value, 0);
    case 'location':
      return normalizeLocation(value);
    case 'buildings':
      return normalizeBuildings(value);
    case 'spaces':
      return normalizeSpaces(value);
    case 'selectedSpaceId':
      return normalizeId(value);
    case 'obstacles':
      return normalizeObstacles(value);
    case 'sunAnalysis':
      return normalizeSunAnalysis(value);
    case 'annualUsageKwh':
      return normalizeAnnualUsageKwh(value);
    case 'selectedKit':
      return normalizeSelectedKit(value);
    case 'results':
      return normalizeResults(value);
    default:
      return value;
  }
}

export function reconcileDerivedState(targetState, sourceUpdates = {}, defaultState = {}) {
  const defaultCurrentStep = defaultState.currentStep ?? 0;
  const defaultMaxVisitedStep = defaultState.maxVisitedStep ?? 0;

  if ('currentStep' in sourceUpdates || 'maxVisitedStep' in sourceUpdates) {
    targetState.maxVisitedStep = Math.max(
      normalizeStepIndex(targetState.currentStep, defaultCurrentStep),
      normalizeStepIndex(targetState.maxVisitedStep, defaultMaxVisitedStep)
    );
  }

  if ('spaces' in sourceUpdates || 'selectedSpaceId' in sourceUpdates) {
    targetState.selectedSpaceId = reconcileSelectedSpaceId(targetState.selectedSpaceId, targetState.spaces);
  }

  if ('sunAnalysis' in sourceUpdates || 'spaces' in sourceUpdates) {
    targetState.sunAnalysis = reconcileSunAnalysis(targetState.sunAnalysis, targetState.spaces);
  }
}

export function normalizeStepIndex(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_STEP_INDEX, Math.max(0, parsed));
}

export function normalizeLocation(value) {
  if (!value || typeof value !== 'object') return null;

  const lat = clampNumber(value.lat, -90, 90);
  const lng = clampNumber(value.lng, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    displayName: sanitizeText(value.displayName, 160),
    postcode: sanitizeText(value.postcode, 24),
  };
}

export function normalizeBuildings(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((building) => normalizeBuilding(building))
    .filter(Boolean);
}

export function normalizeBuilding(building) {
  if (!building || typeof building !== 'object') return null;

  const lat = clampNumber(building.lat, -90, 90);
  const lng = clampNumber(building.lng, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    ...building,
    id: normalizeId(building.id) || 'user-building',
    kind: sanitizeText(building.kind, 24) || 'user',
    lat,
    lng,
    height: clampNumber(building.height, 2, 80),
    widthM: clampNumber(building.widthM, 1, 200),
    depthM: clampNumber(building.depthM, 1, 200),
    frontDoorFacing: normalizeOptionalDegrees(building.frontDoorFacing),
    footprint: normalizeLatLngPoints(building.footprint, { minLength: 3, maxLength: 128 }),
  };
}

export function normalizeSpaces(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((space) => normalizeSpace(space))
    .filter(Boolean);
}

export function normalizeSpace(space) {
  if (!space || typeof space !== 'object') {
    return null;
  }

  const id = normalizeId(space.id);
  const centerLat = clampNumber(space.centerLat, -90, 90);
  const centerLng = clampNumber(space.centerLng, -180, 180);
  if (!id || !Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return null;
  }

  const type = SPACE_TYPE_IDS.has(space.type) ? space.type : 'ground';
  const typeInfo = getSpaceTypeInfo(type);

  return {
    ...space,
    id,
    name: sanitizeText(space.name, 80) || 'Panel location',
    type,
    typeIcon: typeInfo.icon,
    centerLat,
    centerLng,
    orientation: normalizeDegrees(clampNumber(space.orientation, 0, 359) ?? 180),
    displayRotation: normalizeDegrees(clampNumber(space.displayRotation, 0, 359) ?? (clampNumber(space.orientation, 0, 359) ?? 180)),
    tilt: clampNumber(space.tilt, 0, 90) ?? 35,
    avgDailyHours: clampNumber(space.avgDailyHours, 0, 24),
    annualHours: clampNumber(space.annualHours, 0, 24 * 366),
    score: clampNumber(space.score, 0, 24),
    shadowFactor: clampNumber(space.shadowFactor, 0, 1),
    conservativeFactor: clampNumber(space.conservativeFactor, 0, 1),
    optimisticFactor: clampNumber(space.optimisticFactor, 0, 1),
    confidence: normalizeConfidence(space.confidence),
    relativeDirectionLabel: sanitizeText(space.relativeDirectionLabel, 80),
    warningLevel: normalizeWarningLevel(space.warningLevel),
    warnings: normalizeWarnings(space.warnings),
    alignmentHint: sanitizeText(space.alignmentHint, 120),
    orientationLabel: sanitizeText(space.orientationLabel, 80),
    breakdown: normalizeBreakdown(space.breakdown),
    obstructionSummary: normalizeObstructionSummary(space.obstructionSummary),
    monthly: normalizeMonthlyScores(space.monthly),
    polygon: normalizeLatLngPoints(space.polygon, { maxLength: 128 }),
  };
}

export function normalizeObstacles(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((obstacle) => normalizeObstacle(obstacle))
    .filter(Boolean);
}

export function normalizeObstacle(obstacle) {
  if (!obstacle || typeof obstacle !== 'object') {
    return null;
  }

  const id = normalizeId(obstacle.id);
  if (!id || !OBSTACLE_TYPE_IDS.has(obstacle.type)) {
    return null;
  }

  if (obstacle.type === 'fence') {
    const points = normalizeLatLngPoints(obstacle.points, { minLength: 2, maxLength: 64 });
    if (points.length < 2) return null;

    return {
      ...obstacle,
      id,
      type: 'fence',
      points,
      heightM: clampNumber(obstacle.heightM, 0.5, 8) ?? 1.8,
    };
  }

  if (obstacle.type === 'tree') {
    const lat = clampNumber(obstacle.lat, -90, 90);
    const lng = clampNumber(obstacle.lng, -180, 180);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      ...obstacle,
      id,
      type: 'tree',
      lat,
      lng,
      heightM: clampNumber(obstacle.heightM, 1, 40) ?? 5,
      canopyRadiusM: clampNumber(obstacle.canopyRadiusM, 0.5, 30) ?? 3,
    };
  }

  const lat = clampNumber(obstacle.lat, -90, 90);
  const lng = clampNumber(obstacle.lng, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    ...obstacle,
    id,
    type: 'shed',
    lat,
    lng,
    widthM: clampNumber(obstacle.widthM, 0.5, 60) ?? 3,
    depthM: clampNumber(obstacle.depthM, 0.5, 60) ?? 2,
    heightM: clampNumber(obstacle.heightM, 1, 20) ?? 2.5,
    rotationDeg: normalizeDegrees(clampNumber(obstacle.rotationDeg, 0, 359) ?? 0),
  };
}

export function normalizeSunAnalysis(value) {
  if (!value || typeof value !== 'object') return null;

  const scores = Array.isArray(value.scores)
    ? value.scores
      .map((score) => normalizeAnalysisScore(score))
      .filter(Boolean)
    : [];

  return {
    ...value,
    bestSpaceId: normalizeId(value.bestSpaceId),
    scores,
    date: sanitizeText(value.date, 64) || null,
  };
}

export function reconcileSelectedSpaceId(selectedSpaceId, spaces) {
  if (typeof selectedSpaceId !== 'string') return null;
  return Array.isArray(spaces) && spaces.some((space) => space.id === selectedSpaceId)
    ? selectedSpaceId
    : null;
}

export function reconcileSunAnalysis(sunAnalysis, spaces) {
  if (!sunAnalysis) return null;

  const validSpaceIds = new Set((spaces || []).map((space) => space.id));
  if (!validSpaceIds.size) {
    return null;
  }

  const scores = (sunAnalysis.scores || []).filter((score) => validSpaceIds.has(score.id));
  if (!scores.length) {
    return null;
  }

  return {
    ...sunAnalysis,
    scores,
    bestSpaceId: validSpaceIds.has(sunAnalysis.bestSpaceId) ? sunAnalysis.bestSpaceId : scores[0].id,
  };
}

export function normalizeAnalysisScore(score) {
  if (!score || typeof score !== 'object') {
    return null;
  }

  const normalizedSpace = normalizeSpace(score);
  if (!normalizedSpace) {
    return null;
  }

  return {
    ...normalizedSpace,
    relativeToBuilding: normalizeRelativeToBuilding(score.relativeToBuilding),
  };
}

export function normalizeSelectedKit(value) {
  const id = normalizeId(value?.id);
  return id ? { id } : null;
}

export function normalizeAnnualUsageKwh(value) {
  if (value == null || value === '') return null;
  return clampNumber(value, 100, 100000);
}

export function normalizeResults(value) {
  if (!value || typeof value !== 'object') return null;

  return {
    ...value,
    annualKwh: clampNumber(value.annualKwh, 0, 100000),
    conservativeKwh: clampNumber(value.conservativeKwh, 0, 100000),
    optimisticKwh: clampNumber(value.optimisticKwh, 0, 100000),
    annualValue: clampNumber(value.annualValue, 0, 1000000),
    annualBillSavings: clampNumber(value.annualBillSavings, 0, 1000000),
    annualExportIncome: clampNumber(value.annualExportIncome, 0, 1000000),
    selfUsedKwh: clampNumber(value.selfUsedKwh, 0, 100000),
    exportKwh: clampNumber(value.exportKwh, 0, 100000),
    paybackYears: clampNumber(value.paybackYears, 0, 100),
    upgradeKitId: normalizeId(value.upgradeKitId),
  };
}

export function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SAFE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function normalizeLatLngPoints(value, options = {}) {
  if (!Array.isArray(value)) return [];

  const maxLength = options.maxLength ?? 128;
  const points = value
    .slice(0, maxLength)
    .map((point) => {
      const lat = clampNumber(point?.lat, -90, 90);
      const lng = clampNumber(point?.lng, -180, 180);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return { lat, lng };
    })
    .filter(Boolean);

  return points.length >= (options.minLength ?? 0) ? points : [];
}

export function sanitizeText(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeConfidence(value) {
  return SAFE_CONFIDENCE_LEVELS.has(value) ? value : 'medium';
}

function normalizeWarningLevel(value) {
  return SAFE_WARNING_LEVELS.has(value) ? value : 'low';
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 8)
    .map((warning) => sanitizeText(warning, 120))
    .filter(Boolean);
}

function normalizeBreakdown(value) {
  if (!value || typeof value !== 'object') {
    return { morning: 'mixed', midday: 'mixed', afternoon: 'mixed' };
  }

  return {
    morning: SAFE_BREAKDOWN_VALUES.has(value.morning) ? value.morning : 'mixed',
    midday: SAFE_BREAKDOWN_VALUES.has(value.midday) ? value.midday : 'mixed',
    afternoon: SAFE_BREAKDOWN_VALUES.has(value.afternoon) ? value.afternoon : 'mixed',
  };
}

function normalizeObstructionSummary(value) {
  if (!value || typeof value !== 'object') return {};

  const summary = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    if (!SAFE_OBSTRUCTION_KEYS.has(key)) return;
    summary[key] = clampNumber(entryValue, 0, 24 * 366);
  });
  return summary;
}

function normalizeMonthlyScores(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 12)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      return {
        month: sanitizeText(entry.month, 8),
        hours: clampNumber(entry.hours, 0, 24),
        shadowFactor: clampNumber(entry.shadowFactor, 0, 1),
      };
    })
    .filter(Boolean);
}

function normalizeRelativeToBuilding(value) {
  if (!value || typeof value !== 'object') return null;

  return {
    side: sanitizeText(value.side, 24),
    distance: clampNumber(value.distance, 0, 500),
    angle: normalizeOptionalDegrees(value.angle),
  };
}

function normalizeOptionalDegrees(value) {
  const number = clampNumber(value, 0, 359);
  return Number.isFinite(number) ? normalizeDegrees(number) : null;
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}
