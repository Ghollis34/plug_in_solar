import config from '../data/config.json';
import { calculateROI } from './roi.js';
import {
  getQuoteAssumptionProfile,
  resolveQuoteAssumptionMode,
  shouldAssumeFullSolarCapture,
} from './quote-assumptions.js';

export function assumesNoSolarSpill() {
  return Boolean(config.assumeNoSolarSpill);
}

export function hasExportPayment() {
  return (config.exportTariff ?? 0) > 0;
}

export function usesFullSolarCapture(kit, options = {}) {
  return shouldAssumeFullSolarCapture(kit, options.assumptionMode);
}

export function buildScenario(kit, solarData = {}, options = {}) {
  const assumptionMode = resolveQuoteAssumptionMode(options.assumptionMode);
  const baselineFactor = clamp(options.baselineFactor ?? 1, 0, 1.5);
  const conservativeFactor = clamp(options.conservativeFactor ?? baselineFactor, 0, 1.5);
  const optimisticFactor = clamp(options.optimisticFactor ?? baselineFactor, 0, 1.5);
  const baseAnnualKwh = resolveAnnualKwh(solarData, kit);
  const pricing = options.pricing || {};
  const annualUsageKwh = Number.isFinite(options.annualUsageKwh) ? options.annualUsageKwh : config.defaultAnnualElectricityUsageKwh;

  const adjusted = buildAdjusted(baseAnnualKwh, baselineFactor);
  const conservativeAdjusted = buildAdjusted(baseAnnualKwh, conservativeFactor);
  const optimisticAdjusted = buildAdjusted(baseAnnualKwh, optimisticFactor);
  const valueModel = buildValueModel(kit, adjusted.annualKwh, annualUsageKwh, pricing, assumptionMode);
  const conservativeValueModel = buildValueModel(kit, conservativeAdjusted.annualKwh, annualUsageKwh, pricing, assumptionMode);
  const optimisticValueModel = buildValueModel(kit, optimisticAdjusted.annualKwh, annualUsageKwh, pricing, assumptionMode);
  const roi = calculateROI({
    kitCost: kit.price,
    annualKwh: adjusted.annualKwh,
    annualValuePerKwh: valueModel.annualValuePerKwh,
    annualFixedValue: valueModel.smartTariffSavings,
    warrantyYears: kit.warrantyYears,
  });
  const conservativeRoi = calculateROI({
    kitCost: kit.price,
    annualKwh: conservativeAdjusted.annualKwh,
    annualValuePerKwh: conservativeValueModel.annualValuePerKwh,
    annualFixedValue: conservativeValueModel.smartTariffSavings,
    warrantyYears: kit.warrantyYears,
  });
  const optimisticRoi = calculateROI({
    kitCost: kit.price,
    annualKwh: optimisticAdjusted.annualKwh,
    annualValuePerKwh: optimisticValueModel.annualValuePerKwh,
    annualFixedValue: optimisticValueModel.smartTariffSavings,
    warrantyYears: kit.warrantyYears,
  });

  return {
    kit,
    adjusted,
    conservativeAdjusted,
    optimisticAdjusted,
    valueModel,
    conservativeValueModel,
    optimisticValueModel,
    assumptionMode,
    assumptionProfile: getQuoteAssumptionProfile(assumptionMode),
    roi,
    conservativeRoi,
    optimisticRoi,
  };
}

function resolveAnnualKwh(solarData, kit) {
  const candidates = [
    solarData?.annualKwh,
    solarData?.annualYieldKwh,
    solarData?.totals?.fixed?.E_y,
    solarData?.outputs?.totals?.fixed?.E_y,
  ];
  const fromSolarData = candidates.find(Number.isFinite);
  if (Number.isFinite(fromSolarData)) return fromSolarData;
  return Math.max(1, (kit?.wattage || 400) * 0.9);
}

function buildAdjusted(baseAnnualKwh, factor) {
  return {
    annualKwh: round(baseAnnualKwh * factor, 1),
    monthlyKwh: round((baseAnnualKwh * factor) / 12, 1),
  };
}

function buildValueModel(kit, annualKwh, annualUsageKwh, pricing, assumptionMode) {
  const unitRatePence = Number.isFinite(pricing.unitRatePence) ? pricing.unitRatePence : config.electricityPrice;
  const exportRatePence = Number.isFinite(config.exportTariff) ? config.exportTariff : 0;
  const selfUseRatio = getSelfUseRatio(kit, annualKwh, annualUsageKwh, assumptionMode);
  const selfUsedKwh = round(annualKwh * selfUseRatio, 1);
  const exportKwh = Math.max(0, round(annualKwh - selfUsedKwh, 1));
  const billSavings = round(selfUsedKwh * (unitRatePence / 100), 2);
  const exportIncome = round(exportKwh * (exportRatePence / 100), 2);
  const smartTariffShiftKwh = getSmartTariffShiftKwh(kit, annualUsageKwh);
  const smartTariffSavings = getSmartTariffSavings(kit, annualUsageKwh, unitRatePence, smartTariffShiftKwh);
  const annualValue = round(billSavings + exportIncome + smartTariffSavings, 2);

  return {
    annualValue,
    billSavings,
    exportIncome,
    selfUsedKwh,
    exportKwh,
    shiftedKwh: kit?.hasBattery ? round(Math.min(exportKwh, (kit.batteryCapacityWh || 0) / 1000 * 220), 1) : 0,
    smartTariffShiftKwh,
    smartTariffSavings,
    annualValuePerKwh: annualKwh > 0 ? annualValue / annualKwh : unitRatePence / 100,
    unitRatePence,
    exportRatePence,
    selfUseRatio,
  };
}

function getSelfUseRatio(kit, annualKwh, annualUsageKwh, assumptionMode) {
  if (usesFullSolarCapture(kit, { assumptionMode })) {
    return 1;
  }

  const profile = getQuoteAssumptionProfile(assumptionMode);
  const demandRatio = annualUsageKwh > 0 ? annualUsageKwh / Math.max(annualKwh, 1) : 1;
  const base = (config.solarSelfUseBaseRatio ?? 0.84) + profile.selfUseAdjustment;
  return clamp(base + Math.min(0.12, demandRatio * 0.02), config.solarSelfUseMinRatio ?? 0.72, config.solarSelfUseMaxRatio ?? 0.96);
}

function getSmartTariffShiftKwh(kit, annualUsageKwh) {
  if (!kit?.hasBattery || !kit?.supportsSmartTariffShifting) return 0;
  const batteryKwh = (kit.batteryCapacityWh || 0) / 1000;
  const activeDays = config.smartTariffActiveDaysBase ?? 300;
  const cycleRatio = config.smartTariffBatteryCycleRatio ?? 0.8;
  return round(Math.min(annualUsageKwh * 0.35, batteryKwh * activeDays * cycleRatio), 1);
}

function getSmartTariffSavings(kit, annualUsageKwh, unitRatePence, smartTariffShiftKwh = getSmartTariffShiftKwh(kit, annualUsageKwh)) {
  if (!kit?.hasBattery || !kit?.supportsSmartTariffShifting) return 0;
  const offPeak = config.smartTariffOffPeakPrice ?? 0;
  const spread = Math.max(0, unitRatePence - offPeak) / 100;
  return round(smartTariffShiftKwh * spread, 2);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
