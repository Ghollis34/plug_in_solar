import { describe, expect, it } from 'vitest';
import { normalizeCustomUnitRatePence, resolveElectricityPricing } from './electricity-pricing.js';
import { findPricedKitById, getPricedKits } from './kit-pricing.js';
import { buildScenario, usesFullSolarCapture } from './quote-model.js';

describe('quote support modules', () => {
  it('normalises homeowner electricity price inputs in pence per kWh', () => {
    expect(normalizeCustomUnitRatePence('24.5')).toBe(24.5);
    expect(normalizeCustomUnitRatePence(-1)).toBeNull();
    expect(resolveElectricityPricing(null, 30)).toMatchObject({
      unitRatePence: 30,
      mode: 'custom',
    });
  });

  it('returns priced kits filtered by compatible placement type', () => {
    const wallKits = getPricedKits(null, { spaceType: 'wall' });

    expect(wallKits.length).toBeGreaterThan(0);
    expect(wallKits.every((kit) => kit.mountingTypes.includes('wall'))).toBe(true);
    expect(findPricedKitById(wallKits[0].id, null, { spaceType: 'wall' })).toMatchObject({
      id: wallKits[0].id,
      priceMeta: expect.any(Object),
    });
  });

  it('builds ROI scenarios with conservative and optimistic ranges', () => {
    const kit = getPricedKits()[0];
    const scenario = buildScenario(kit, { annualKwh: 600 }, {
      baselineFactor: 0.7,
      conservativeFactor: 0.6,
      optimisticFactor: 0.8,
      annualUsageKwh: 2700,
      pricing: resolveElectricityPricing(null, 25),
    });

    expect(scenario.adjusted.annualKwh).toBeGreaterThan(0);
    expect(scenario.conservativeAdjusted.annualKwh).toBeLessThan(scenario.optimisticAdjusted.annualKwh);
    expect(scenario.valueModel.annualValue).toBeGreaterThan(0);
    expect(scenario.roi).toMatchObject({ roiPercent: expect.any(Number) });
    expect(usesFullSolarCapture({ hasBattery: true })).toBe(true);
  });
});
