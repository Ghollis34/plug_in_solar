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

  it('loads a static live pricing feed when available and keeps catalogue fallback when unavailable', async () => {
    const feed = await import('./kit-pricing.js').then(({ loadLivePricing }) => loadLivePricing(async () => ({
      ok: true,
      json: async () => ({
        status: 'live',
        updatedAt: '2026-05-30T12:00:00.000Z',
        kits: {
          'ecoflow-powerstream-400': {
            price: 455,
            detail: 'Retailer feed checked today.',
          },
        },
      }),
    })));

    const pricedKit = findPricedKitById('ecoflow-powerstream-400', feed);

    expect(feed.status).toBe('live');
    expect(pricedKit.price).toBe(455);
    expect(pricedKit.priceMeta).toMatchObject({
      status: 'live',
      label: 'Live price',
    });

    const fallback = await import('./kit-pricing.js').then(({ loadLivePricing }) => loadLivePricing(async () => ({ ok: false, status: 404 })));
    expect(fallback.status).toBe('fallback');
    expect(findPricedKitById('ecoflow-powerstream-400', fallback).price).toBeGreaterThan(455);
  });

  it('preserves catalogue snapshot labels from generated pricing feeds', () => {
    const pricedKit = findPricedKitById('ecoflow-powerstream-400', {
      status: 'catalogue-snapshot',
      kits: {
        'ecoflow-powerstream-400': {
          price: 499,
          priceMeta: {
            status: 'catalogue-snapshot',
            label: 'Catalogue snapshot',
            detail: 'Generated from the app catalogue.',
          },
        },
      },
    });

    expect(pricedKit.priceMeta).toMatchObject({
      status: 'catalogue-snapshot',
      label: 'Catalogue snapshot',
      detail: 'Generated from the app catalogue.',
    });
  });

  it('supports conservative, balanced, and optimistic quote assumption modes', () => {
    const solarOnlyKit = getPricedKits().find((kit) => !kit.hasBattery && kit.wattage >= 700);
    const conservativeScenario = buildScenario(solarOnlyKit, { annualKwh: 700 }, {
      assumptionMode: 'conservative',
      baselineFactor: 1,
      annualUsageKwh: 1800,
      pricing: resolveElectricityPricing(null, 25),
    });
    const optimisticScenario = buildScenario(solarOnlyKit, { annualKwh: 700 }, {
      assumptionMode: 'optimistic',
      baselineFactor: 1,
      annualUsageKwh: 1800,
      pricing: resolveElectricityPricing(null, 25),
    });

    expect(usesFullSolarCapture(solarOnlyKit, { assumptionMode: 'conservative' })).toBe(false);
    expect(usesFullSolarCapture(solarOnlyKit, { assumptionMode: 'optimistic' })).toBe(true);
    expect(conservativeScenario.valueModel.exportKwh).toBeGreaterThan(0);
    expect(optimisticScenario.valueModel.exportKwh).toBe(0);
    expect(optimisticScenario.valueModel.annualValue).toBeGreaterThan(conservativeScenario.valueModel.annualValue);
  });
});
