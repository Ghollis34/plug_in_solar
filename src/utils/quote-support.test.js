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

  it('exposes display-safe pricing source detail for result disclaimers', () => {
    expect(resolveElectricityPricing(null, 30)).toMatchObject({
      source: 'User-entered electricity price',
      sourceDetail: 'User-entered electricity price',
    });
  });

  it('reports smart tariff shifted kWh separately from solar shifted later', () => {
    const batteryKit = getPricedKits().find((kit) => kit.hasBattery && kit.supportsSmartTariffShifting);
    const scenario = buildScenario(batteryKit, { annualKwh: 700 }, {
      baselineFactor: 1,
      conservativeFactor: 0.9,
      optimisticFactor: 1,
      annualUsageKwh: 2700,
      pricing: resolveElectricityPricing(null, 25),
    });

    expect(scenario.valueModel.smartTariffSavings).toBeGreaterThan(0);
    expect(scenario.valueModel.smartTariffShiftKwh).toBeGreaterThan(0);
    expect(Number.isFinite(scenario.valueModel.smartTariffShiftKwh)).toBe(true);
  });
});
