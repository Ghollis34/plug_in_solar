import config from '../data/config.json';

const DEFAULT_REGION = 'UK average';

export function normalizeCustomUnitRatePence(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function resolveElectricityPricing(location = null, customUnitRatePence = null) {
  const customRate = normalizeCustomUnitRatePence(customUnitRatePence);
  const defaultRate = normalizeCustomUnitRatePence(config.electricityPrice) ?? 24.67;

  return {
    unitRatePence: customRate ?? defaultRate,
    unitRate: (customRate ?? defaultRate) / 100,
    mode: customRate == null ? 'default' : 'custom',
    region: resolveRegionLabel(location),
    source: customRate == null ? config.electricityPriceSource : 'User-entered electricity price',
    updated: customRate == null ? config.electricityPriceUpdated : null,
  };
}

function resolveRegionLabel(location) {
  if (location?.postcode) return String(location.postcode).trim().toUpperCase();
  if (location?.address) return String(location.address).split(',').slice(-2, -1)[0]?.trim() || DEFAULT_REGION;
  return DEFAULT_REGION;
}
