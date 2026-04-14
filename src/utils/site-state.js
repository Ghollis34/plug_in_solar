import config from '../data/config.json';
import { resolveElectricityPricing } from './electricity-pricing.js';
import { getRectangleRing } from './geometry.js';
import { getState } from './state.js';

export const DEFAULT_ANNUAL_USAGE_KWH = config.defaultAnnualElectricityUsageKwh ?? 2700;
export const DEFAULT_ANNUAL_USAGE_SOURCE = config.defaultAnnualElectricityUsageSource || 'Ofgem typical household electricity use';

export function getLocationState(state = null) {
  return resolveState(state).location || null;
}

export function getBuildingsState(state = null) {
  const snapshot = resolveState(state);
  return Array.isArray(snapshot.buildings) ? snapshot.buildings : [];
}

export function getSpacesState(state = null) {
  const snapshot = resolveState(state);
  return Array.isArray(snapshot.spaces) ? snapshot.spaces : [];
}

export function getObstaclesState(state = null) {
  const snapshot = resolveState(state);
  return Array.isArray(snapshot.obstacles) ? snapshot.obstacles : [];
}

export function getSelectedSpaceIdState(state = null) {
  const selectedSpaceId = resolveState(state).selectedSpaceId;
  return typeof selectedSpaceId === 'string' ? selectedSpaceId : null;
}

export function getSunAnalysisScores(state = null) {
  const scores = resolveState(state).sunAnalysis?.scores;
  return Array.isArray(scores) ? scores : [];
}

export function getPrimaryBuilding(state = null) {
  return getBuildingsState(state)
    .find((building) => building.kind === 'user' || building.id === 'user-building') || null;
}

export function getPrimaryBuildingFootprint(state = null) {
  const building = getPrimaryBuilding(state);
  if (!building) return [];

  if (building.footprint?.length >= 3) {
    return building.footprint;
  }

  if (Number.isFinite(building.lat) && Number.isFinite(building.lng) && Number.isFinite(building.frontDoorFacing)) {
    return getRectangleRing(
      building.lat,
      building.lng,
      building.widthM || 5,
      building.depthM || 9,
      building.frontDoorFacing
    ).slice(0, -1);
  }

  return [];
}

export function getPrimaryBuildingCentroid(state = null) {
  const footprint = getPrimaryBuildingFootprint(state);
  if (footprint.length >= 3) {
    return getPointCentroid(footprint);
  }

  const building = getPrimaryBuilding(state);
  if (Number.isFinite(building?.lat) && Number.isFinite(building?.lng)) {
    return { lat: building.lat, lng: building.lng };
  }

  return null;
}

export function getAnalysisCenter(state = null, fallbackLocation = null) {
  const building = getPrimaryBuilding(state);
  if (Number.isFinite(building?.lat) && Number.isFinite(building?.lng)) {
    return { lat: building.lat, lng: building.lng };
  }

  return fallbackLocation || getLocationState(state);
}

export function getSelectedSpace(state = null) {
  const selectedSpaceId = getSelectedSpaceIdState(state);
  if (!selectedSpaceId) return null;
  return getSpacesState(state).find((space) => space.id === selectedSpaceId) || null;
}

export function getSelectedOrRecommendedSpace(state = null) {
  const selectedSpaceId = getSelectedSpaceIdState(state);
  const rankedSpaces = getSunAnalysisScores(state);
  const spaces = getSpacesState(state);

  return rankedSpaces.find((space) => space.id === selectedSpaceId)
    || rankedSpaces[0]
    || spaces.find((space) => space.id === selectedSpaceId)
    || spaces[0]
    || null;
}

export function getRecommendedSpace(state = null) {
  return getSunAnalysisScores(state)[0] || getSelectedOrRecommendedSpace(state);
}

export function getAnnualUsageInput(state = null) {
  const annualUsageKwh = resolveState(state).annualUsageKwh;
  return Number.isFinite(annualUsageKwh) ? annualUsageKwh : null;
}

export function getResolvedAnnualUsageKwh(state = null) {
  return getAnnualUsageInput(state) ?? DEFAULT_ANNUAL_USAGE_KWH;
}

export function isUsingDefaultAnnualUsage(state = null) {
  return getAnnualUsageInput(state) == null;
}

export function getElectricityPriceInput(state = null) {
  const electricityPricePence = resolveState(state).electricityPricePence;
  return Number.isFinite(electricityPricePence) ? electricityPricePence : null;
}

export function isUsingCustomElectricityPrice(state = null) {
  return getElectricityPriceInput(state) != null;
}

export function getResolvedElectricityPricing(state = null) {
  return resolveElectricityPricing(getLocationState(state), getElectricityPriceInput(state));
}

function resolveState(state) {
  return state && typeof state === 'object' ? state : getState();
}

function getPointCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  const totals = points.reduce((acc, point) => ({
    lat: acc.lat + (point?.lat || 0),
    lng: acc.lng + (point?.lng || 0),
  }), { lat: 0, lng: 0 });

  return {
    lat: totals.lat / points.length,
    lng: totals.lng / points.length,
  };
}
