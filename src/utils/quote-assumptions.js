import config from '../data/config.json';

export const QUOTE_ASSUMPTION_PROFILES = {
  conservative: {
    id: 'conservative',
    label: 'Conservative',
    pill: 'Conservative model active',
    summary: 'Counts only likely household self-use and treats unused generation as unpaid spill unless an export tariff is configured.',
    detail: 'Best for a cautious first quote when daytime electricity use is uncertain.',
    selfUseAdjustment: -0.12,
    fullCaptureSolarOnly: false,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    pill: 'Balanced model active',
    summary: 'Uses a high daytime-use assumption for plug-in solar, but still shows solar-only spill separately.',
    detail: 'Good default for an initial homeowner quote before bills or smart-meter data are available.',
    selfUseAdjustment: 0,
    fullCaptureSolarOnly: false,
  },
  optimistic: {
    id: 'optimistic',
    label: 'Optimistic',
    pill: 'Optimistic model active',
    summary: 'Assumes the household or storage setup captures all modelled solar value with no unpaid spill.',
    detail: 'Use when the homeowner expects strong daytime demand, export value, or active battery/storage management.',
    selfUseAdjustment: 0.08,
    fullCaptureSolarOnly: true,
  },
};

export const QUOTE_ASSUMPTION_MODE_OPTIONS = Object.values(QUOTE_ASSUMPTION_PROFILES);

export function resolveQuoteAssumptionMode(value = null) {
  if (Object.prototype.hasOwnProperty.call(QUOTE_ASSUMPTION_PROFILES, value)) {
    return value;
  }

  const configured = config.quoteAssumptionMode;
  if (Object.prototype.hasOwnProperty.call(QUOTE_ASSUMPTION_PROFILES, configured)) {
    return configured;
  }

  return config.assumeNoSolarSpill ? 'optimistic' : 'balanced';
}

export function getQuoteAssumptionProfile(value = null) {
  return QUOTE_ASSUMPTION_PROFILES[resolveQuoteAssumptionMode(value)];
}

export function shouldAssumeFullSolarCapture(kit, mode = null) {
  if (!kit) return false;
  if (kit.hasBattery || kit.batteryCapacityWh) return true;
  return getQuoteAssumptionProfile(mode).fullCaptureSolarOnly;
}
