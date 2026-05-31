import Chart from 'chart.js/auto';
import kitsData from '../data/kits.json';
import { getState, setState } from '../utils/state.js';
import { fetchSolarData } from '../utils/pvgis.js';
import {
  findPricedKitById,
  getKitPriceDetailLabel,
  getKitPriceStatusLabel,
  loadLivePricing,
} from '../utils/kit-pricing.js';
import { formatCurrency, formatPayback } from '../utils/roi.js';
import config from '../data/config.json';
import { escapeHtml, safeDataId, sanitizeExternalUrl } from '../utils/security.js';
import { normalizeCustomUnitRatePence } from '../utils/electricity-pricing.js';
import { ALLOWED_RETAILER_HOSTS, resolveRetailerLink } from '../utils/referrals.js';
import { buildScenario, hasExportPayment, usesFullSolarCapture } from '../utils/quote-model.js';
import {
  DEFAULT_ANNUAL_USAGE_KWH,
  DEFAULT_ANNUAL_USAGE_SOURCE,
  getAnnualUsageInput,
  getElectricityPriceInput,
  getLocationState,
  getResolvedElectricityPricing,
  getRecommendedSpace,
  getResolvedAnnualUsageKwh,
  getSelectedOrRecommendedSpace,
  isUsingCustomElectricityPrice,
  isUsingDefaultAnnualUsage,
} from '../utils/site-state.js';

let charts = [];
let calculationRequestId = 0;
const RESULTS_STICKY_ACTIONS_ID = 'results-sticky-actions';

export function render() {
  const selectedKit = resolveSelectedKit(getState('selectedKit'));
  const annualUsageInput = getAnnualUsageInput();
  const resolvedAnnualUsage = getResolvedAnnualUsageKwh();
  const usingDefaultAnnualUsage = isUsingDefaultAnnualUsage();
  const electricityPriceInput = getElectricityPriceInput();
  const resolvedPricing = getResolvedElectricityPricing();
  const usingCustomElectricityPrice = isUsingCustomElectricityPrice();

  return `
    <div class="step-page scrollable">
      <div class="step-header">
        <div class="section-kicker">Step 6 · Results</div>
        <h2 class="step-title">Your Solar Blueprint</h2>
        <p class="step-subtitle">See the likely generation, value, payback, and whether a battery upgrade is worth pricing.</p>
      </div>

      <div class="step-body">
        <div id="results-loading" class="loading-overlay">
          <div class="loading-spinner"></div>
          <p>Calculating your solar potential...</p>
          <p style="font-size: 0.8rem; color: var(--text-muted);">Fetching irradiance data from EU PVGIS database</p>
        </div>

        <div id="results-content" class="hidden">
          <div class="results-shell">
            <div class="card-flat results-usage-card">
              <div class="results-usage-header">
                <div>
                  <div class="results-kicker">Home usage assumption</div>
                  <h3 class="results-usage-title">Estimated yearly electricity use</h3>
                </div>
                <div class="map-panel-pill" id="annual-usage-pill">${usingDefaultAnnualUsage ? 'UK average active' : 'Custom value active'}</div>
              </div>
              <div class="results-usage-grid">
                <div>
                  <label class="form-label" for="annual-usage-input">Annual home usage (kWh)</label>
                  <div class="results-usage-input-row">
                    <input type="number" class="form-input" id="annual-usage-input" min="100" max="100000" step="50" value="${annualUsageInput ?? ''}" placeholder="${DEFAULT_ANNUAL_USAGE_KWH}" />
                    <button class="btn btn-outline" id="btn-apply-usage" type="button">Update Quote</button>
                  </div>
                  <div class="analysis-note" id="annual-usage-helper">${getAnnualUsageHelperText(usingDefaultAnnualUsage, resolvedAnnualUsage, selectedKit)}</div>
                </div>
                <div class="results-usage-summary">
                  <div class="results-usage-summary-label" id="annual-usage-source">${usingDefaultAnnualUsage ? DEFAULT_ANNUAL_USAGE_SOURCE : 'Using your household estimate'}</div>
                  <div class="results-usage-summary-value" id="annual-usage-effective">${formatWholeNumber(resolvedAnnualUsage)} kWh/year</div>
                  <button class="btn btn-secondary" id="btn-use-average-usage" type="button">Use UK Average</button>
                </div>
              </div>
            </div>
            <div class="card-flat results-usage-card">
              <div class="results-usage-header">
                <div>
                  <div class="results-kicker">Electricity tariff assumption</div>
                  <h3 class="results-usage-title">Estimated import unit rate</h3>
                </div>
                <div class="map-panel-pill" id="electricity-price-pill">${escapeHtml(getElectricityPricePillText(resolvedPricing, usingCustomElectricityPrice))}</div>
              </div>
              <div class="results-usage-grid">
                <div>
                  <label class="form-label" for="electricity-price-input">Electricity price (p/kWh)</label>
                  <div class="results-usage-input-row">
                    <input type="number" class="form-input" id="electricity-price-input" min="1" max="100" step="0.01" value="${electricityPriceInput ?? ''}" placeholder="${resolvedPricing.unitRatePence}" />
                    <button class="btn btn-outline" id="btn-apply-electricity-price" type="button">Update Quote</button>
                  </div>
                  <div class="analysis-note" id="electricity-price-helper">${escapeHtml(getElectricityPriceHelperText(resolvedPricing, usingCustomElectricityPrice))}</div>
                </div>
                <div class="results-usage-summary">
                  <div class="results-usage-summary-label" id="electricity-price-source">${escapeHtml(resolvedPricing.source)}</div>
                  <div class="results-usage-summary-value" id="electricity-price-effective">${formatRatePence(resolvedPricing.unitRatePence)} p/kWh</div>
                  <div class="results-usage-summary-detail" id="electricity-price-detail">${escapeHtml(getElectricityPriceDetailText(resolvedPricing))}</div>
                  <button class="btn btn-secondary" id="btn-use-smart-price" type="button">Use Postcode Default</button>
                </div>
              </div>
            </div>
            <div class="recommendation-card" id="recommendation-card"></div>
            <div class="results-grid" id="results-grid"></div>
            <div class="results-chart-grid">
              <div class="chart-container">
                <h4 class="chart-title">Monthly Energy Generation</h4>
                <canvas id="chart-monthly" class="chart-canvas"></canvas>
              </div>

              <div class="chart-container">
                <h4 class="chart-title">Cumulative Energy Value Over Time</h4>
                <canvas id="chart-savings" class="chart-canvas"></canvas>
              </div>
            </div>
            <div id="battery-upgrade-slot"></div>
            <div id="results-actions"></div>

            <div class="disclaimer mt-md">
              <span class="disclaimer-icon">ℹ️</span>
              <span id="price-disclaimer">
                Based on ${config.electricityPriceSource}: ${config.electricityPrice}${config.electricityPriceUnit}.
                Solar irradiance data from EU PVGIS. Shadow estimates are approximate.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-results">← Back</button>
        <button class="btn btn-primary" id="btn-start-again">🔄 Start New Analysis</button>
      </div>
    </div>
  `;
}

export function init() {
  document.getElementById('btn-back-results')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-start-again')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:reset'));
  });

  initAssumptionControls();
  updateAssumptionUi();
  calculateResults();
}

async function calculateResults() {
  const requestId = ++calculationRequestId;
  const location = getLocationState();
  const selectedKitState = getState('selectedKit');
  const selectedSpace = getSelectedOrRecommendedSpace() || {};
  const recommendedSpace = getRecommendedSpace() || selectedSpace;
  const annualUsageKwh = getResolvedAnnualUsageKwh();
  const usingDefaultAnnualUsage = isUsingDefaultAnnualUsage();
  const pricing = getResolvedElectricityPricing();
  const spaceType = selectedSpace?.type || null;

  if (!location || !selectedKitState?.id) {
    showError('Missing location or kit selection.');
    return;
  }

  try {
    const orientation = selectedSpace.orientation || 180;
    const pvgisAzimuth = orientation - 180;
    const tilt = selectedSpace.tilt || 35;

    const [solarData, livePricing] = await Promise.all([
      fetchSolarData(location.lat, location.lng, tilt, pvgisAzimuth),
      loadLivePricing(),
    ]);
    if (requestId !== calculationRequestId) return;

    const selectedKit = resolveSelectedKit(selectedKitState, livePricing, spaceType);
    if (!selectedKit) {
      showError('Missing location or kit selection.');
      return;
    }

    const baselineFactor = clamp(selectedSpace.shadowFactor ?? ((selectedSpace.avgDailyHours || 6) / 12), 0, 1);
    const conservativeFactor = clamp(
      selectedSpace.conservativeFactor ?? (baselineFactor - (config.resultsConservativeShadowDelta ?? 0.1)),
      0,
      1
    );
    const optimisticFactor = clamp(
      selectedSpace.optimisticFactor ?? (baselineFactor + (config.resultsOptimisticShadowDelta ?? 0.2)),
      0,
      1
    );

    const primaryScenario = buildScenario(selectedKit, solarData, {
      baselineFactor,
      conservativeFactor,
      optimisticFactor,
      annualUsageKwh,
      pricing,
    });
    const batteryUpgradeKit = getBatteryUpgradeKit(selectedKit, livePricing, spaceType);
    const upgradeScenario = batteryUpgradeKit
      ? buildScenario(batteryUpgradeKit, solarData, {
        baselineFactor,
        conservativeFactor,
        optimisticFactor,
        annualUsageKwh,
        pricing,
      })
      : null;

    setState({
      results: {
        annualKwh: primaryScenario.adjusted.annualKwh,
        conservativeKwh: primaryScenario.conservativeAdjusted.annualKwh,
        optimisticKwh: primaryScenario.optimisticAdjusted.annualKwh,
        annualValue: primaryScenario.valueModel.annualValue,
        annualBillSavings: primaryScenario.valueModel.billSavings,
        annualExportIncome: primaryScenario.valueModel.exportIncome,
        selfUsedKwh: primaryScenario.valueModel.selfUsedKwh,
        exportKwh: primaryScenario.valueModel.exportKwh,
        paybackYears: primaryScenario.roi.paybackYears,
        electricityPricePence: pricing.unitRatePence,
        electricityPriceMode: pricing.mode,
        electricityRegion: pricing.region,
        upgradeKitId: upgradeScenario?.kit.id || null,
      },
    });
    if (requestId !== calculationRequestId) return;

    displayResults({
      primaryScenario,
      upgradeScenario,
      selectedSpace,
      recommendedSpace,
      solarData,
      annualUsageKwh,
      usingDefaultAnnualUsage,
      pricing,
    });
  } catch (error) {
    if (requestId !== calculationRequestId) return;
    console.error('Results calculation failed:', error);
    showError('Failed to calculate results. Please try again.');
  }
}

function displayResults({ primaryScenario, upgradeScenario, selectedSpace, recommendedSpace, solarData, annualUsageKwh, usingDefaultAnnualUsage, pricing }) {
  const {
    kit,
    roi,
    adjusted,
    conservativeAdjusted,
    optimisticAdjusted,
    valueModel,
    conservativeValueModel,
    optimisticValueModel,
    conservativeRoi,
    optimisticRoi,
  } = primaryScenario;
  const primaryFullCapture = usesFullSolarCapture(kit);
  const upgradeFullCapture = usesFullSolarCapture(upgradeScenario?.kit);
  const headlineAdjusted = optimisticAdjusted;
  const headlineValueModel = optimisticValueModel;
  const headlineRoi = optimisticRoi;
  const exportPaymentEnabled = hasExportPayment();
  const safeKitName = escapeHtml(kit.name);
  const safeSelectedSpaceName = escapeHtml(selectedSpace.name || 'your selected spot');
  const safeRecommendedSpaceName = escapeHtml(recommendedSpace.name || 'recommended spot');
  const safeConfidence = escapeHtml(capitalise(selectedSpace.confidence || 'medium'));
  const safeRelativeDirection = escapeHtml(selectedSpace.relativeDirectionLabel || 'Position estimated');
  const annualValueGain = upgradeScenario
    ? Math.max(0, upgradeScenario.optimisticValueModel.annualValue - headlineValueModel.annualValue)
    : 0;
  const smartTariffIncluded = headlineValueModel.smartTariffSavings > 0;
  const smartTariffGain = upgradeScenario
    ? Math.max(0, upgradeScenario.optimisticValueModel.smartTariffSavings - headlineValueModel.smartTariffSavings)
    : 0;
  const warningsHtml = (selectedSpace.warnings || [])
    .map((warning) => `<div style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(warning)}</div>`)
    .join('');
  const batterySpillNote = !primaryFullCapture && kit.hasBattery && valueModel.exportKwh > 0
    ? `<div class="analysis-note" style="margin: 10px 0 0;">A little remaining solar spill is normal even with a battery. On brighter, lower-load periods the battery is already charging or full, so some midday generation can still pass through.</div>`
    : '';
  const selectionNote = selectedSpace.id && recommendedSpace.id && selectedSpace.id !== recommendedSpace.id
    ? `<div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 8px;">This quote is using <strong>${safeSelectedSpaceName}</strong>. The model still ranks <strong>${safeRecommendedSpaceName}</strong> as the strongest sun location.</div>`
    : '';
  const usageContextCopy = primaryFullCapture
    ? (usingDefaultAnnualUsage
      ? `No household usage was entered, so this quote is using the UK typical household default of <strong>${formatWholeNumber(annualUsageKwh)} kWh/year</strong> from ${escapeHtml(DEFAULT_ANNUAL_USAGE_SOURCE)}. With full solar capture turned on, that mainly fine-tunes storage and smart-tariff assumptions.`
      : `This quote is using your estimated household electricity use of <strong>${formatWholeNumber(annualUsageKwh)} kWh/year</strong>. With full solar capture turned on, that mainly fine-tunes storage and smart-tariff assumptions rather than reducing value through unpaid spill.`)
    : (usingDefaultAnnualUsage
      ? `No household usage was entered, so this quote is using the UK typical household default of <strong>${formatWholeNumber(annualUsageKwh)} kWh/year</strong> from ${escapeHtml(DEFAULT_ANNUAL_USAGE_SOURCE)}. The value model still leans toward a high daytime-occupancy home, so most generated solar is treated as being used on-site.`
      : `This quote is using your estimated household electricity use of <strong>${formatWholeNumber(annualUsageKwh)} kWh/year</strong> to work out how much solar stays on-site versus spills away unused, with a high daytime-occupancy assumption keeping most generation in the home.`);
  const annualValueCopy = primaryFullCapture
    ? smartTariffIncluded
      ? `In the strongest case that could be worth about <strong>${formatCurrency(headlineValueModel.annualValue)}</strong> in year one, including
      <strong>${formatCurrency(headlineValueModel.billSavings)}</strong> of captured solar bill reduction and
      <strong>${formatCurrency(headlineValueModel.smartTariffSavings)}</strong> from low-rate charging and peak-time battery discharge on a smart tariff.
      This quote assumes no unpaid solar spill.`
      : `In the strongest case that could be worth about <strong>${formatCurrency(headlineValueModel.annualValue)}</strong> in year one from captured solar bill reduction.
      This quote assumes all modelled solar generation is captured at your import unit rate, with no unpaid spill.`
    : smartTariffIncluded
    ? `In the strongest case that could be worth about <strong>${formatCurrency(headlineValueModel.annualValue)}</strong> in year one, including
      <strong>${formatCurrency(headlineValueModel.billSavings)}</strong> of solar bill reduction and
      <strong>${formatCurrency(headlineValueModel.smartTariffSavings)}</strong> from low-rate charging and peak-time battery discharge on a smart tariff.
      ${exportPaymentEnabled ? `It also includes <strong>${formatCurrency(headlineValueModel.exportIncome)}</strong> of export income.` : 'Any excess solar sent back to the grid is still treated as unpaid in this quote.'}`
    : exportPaymentEnabled
      ? `In the strongest case that could be worth about <strong>${formatCurrency(headlineValueModel.annualValue)}</strong> in year one, split between
      <strong>${formatCurrency(headlineValueModel.billSavings)}</strong> of avoided grid spend and
      <strong>${formatCurrency(headlineValueModel.exportIncome)}</strong> of export income.`
      : upgradeScenario && !kit.hasBattery
      ? `In the strongest case that could be worth about <strong>${formatCurrency(headlineValueModel.annualValue)}</strong> in year one from avoided grid spend.
      Without a battery, any excess sent back to the grid is lost value in this quote, and the matched battery could recover about
      <strong>${formatCurrency(annualValueGain)}</strong> of that in year one${smartTariffGain > 0 ? `, including about <strong>${formatCurrency(smartTariffGain)}</strong> from smart-tariff charging and discharge` : ''}.`
      : `In the strongest case that could be worth about <strong>${formatCurrency(headlineValueModel.annualValue)}</strong> in year one from avoided grid spend.
      This plug-in solar quote assumes any excess sent back to the grid is unpaid.`;
  const valueBreakdownCopy = primaryFullCapture
    ? smartTariffIncluded
      ? `${formatCurrency(headlineValueModel.billSavings)} captured solar value + ${formatCurrency(headlineValueModel.smartTariffSavings)} smart-tariff shifting`
      : `${formatCurrency(headlineValueModel.billSavings)} captured at the selected unit rate`
    : smartTariffIncluded
    ? `${formatCurrency(headlineValueModel.billSavings)} solar use + ${formatCurrency(headlineValueModel.smartTariffSavings)} smart-tariff shifting`
    : exportPaymentEnabled
    ? `${formatCurrency(headlineValueModel.billSavings)} saved + ${formatCurrency(headlineValueModel.exportIncome)} exported`
    : upgradeScenario && !kit.hasBattery
      ? `${formatCurrency(headlineValueModel.billSavings)} bill reduction + up to ${formatCurrency(annualValueGain)} recoverable with storage`
      : `${formatCurrency(headlineValueModel.billSavings)} bill reduction at this household usage`;
  const gridSpillLabel = primaryFullCapture
    ? 'Solar Capture Assumed'
    : exportPaymentEnabled
    ? 'Exported To Grid'
    : kit.hasBattery
      ? 'Remaining Solar Spill'
    : upgradeScenario && !kit.hasBattery
      ? 'Lost Value Without Battery'
      : 'Sent To Grid';
  const gridSpillCopy = primaryFullCapture
    ? 'All generation is treated as captured value in this quote.'
    : exportPaymentEnabled
    ? `${formatCurrency(headlineValueModel.exportIncome)} best-case year-one export value`
    : kit.hasBattery
      ? 'A small amount can still spill on bright, low-load periods even with storage'
    : upgradeScenario && !kit.hasBattery
      ? `${formatCurrency(annualValueGain)} year-one value could be recovered with a battery${smartTariffGain > 0 ? ` and smart-tariff shifting` : ''}`
      : 'Assumed £0 export payment in this plug-in solar quote';
  const primarySelfUsePercent = Math.round(headlineValueModel.selfUseRatio * 100);
  const upgradeSelfUsePercent = upgradeScenario
    ? Math.round(upgradeScenario.optimisticValueModel.selfUseRatio * 100)
    : null;
  const storageAssumptionCopy = primaryFullCapture
    ? `This quote assumes full solar capture with storage, using ${Math.round((config.batteryRoundTripEfficiency ?? 0.9) * 100)}% round-trip battery efficiency${smartTariffIncluded ? ` and about ${formatWholeNumber(headlineValueModel.smartTariffShiftKwh)} kWh/year of low-rate charging shifted into higher-value periods` : ''}.`
    : kit.hasBattery
    ? `The value model expects roughly ${primarySelfUsePercent}% of yearly solar generation to stay on-site with storage, using ${Math.round((config.batteryRoundTripEfficiency ?? 0.9) * 100)}% round-trip battery efficiency${smartTariffIncluded ? ` and about ${formatWholeNumber(headlineValueModel.smartTariffShiftKwh)} kWh/year of low-rate charging shifted into higher-value periods` : ''}.`
    : upgradeScenario
      ? `The value model expects roughly ${primarySelfUsePercent}% of yearly generation to stay on-site for this solar-only setup under a high daytime-occupancy assumption, rising to about ${upgradeSelfUsePercent}% with the matched battery bundle${upgradeFullCapture ? ' under the battery full-capture assumption' : ''}${smartTariffGain > 0 ? ` plus about ${formatCurrency(smartTariffGain)} of extra smart-tariff battery value` : ''}.`
      : `The value model expects roughly ${primarySelfUsePercent}% of yearly generation to stay on-site for this household usage under a high daytime-occupancy assumption.`;
  const annualValueGrowthCopy = (config.annualValueGrowthRate ?? 0) > 0
    ? `Payback and long-term return also assume saved electricity value rises by about ${Math.round((config.annualValueGrowthRate ?? 0) * 100)}% per year from ${escapeHtml(config.annualValueGrowthSource || 'the quote model')}.`
    : '';
  const kitPriceStatus = getKitPriceStatusLabel(kit.priceMeta);
  const kitPriceDetail = getKitPriceDetailLabel(kit.priceMeta);
  const firstYearValueRange = formatCurrencyRange(conservativeValueModel.annualValue, optimisticValueModel.annualValue);
  const paybackRange = formatPaybackRange(conservativeRoi.paybackYears, optimisticRoi.paybackYears);
  const netReturnRange = formatCurrencyRange(conservativeRoi.netReturn25yr, optimisticRoi.netReturn25yr);
  const firstYearGenerationRange = `${formatWholeNumber(conservativeAdjusted.annualKwh)} to ${formatWholeNumber(optimisticAdjusted.annualKwh)} kWh/year`;
  const selfUseRange = `${formatWholeNumber(conservativeValueModel.selfUsedKwh)} to ${formatWholeNumber(optimisticValueModel.selfUsedKwh)} kWh`;
  const spillRange = `${formatWholeNumber(conservativeValueModel.exportKwh)} to ${formatWholeNumber(optimisticValueModel.exportKwh)} kWh`;
  const smartTariffRange = `${formatWholeNumber(conservativeValueModel.smartTariffShiftKwh)} to ${formatWholeNumber(optimisticValueModel.smartTariffShiftKwh)} kWh`;
  const heroStatNote = primaryFullCapture
    ? `No unpaid spill modelled${smartTariffIncluded ? ` · ${smartTariffRange} smart-tariff shifting` : ''} · ${formatWholeNumber(annualUsageKwh)} kWh/year household use`
    : `${selfUseRange} solar used in home · ${spillRange} remaining solar spill${smartTariffIncluded ? ` · ${smartTariffRange} smart-tariff shifting` : ''} · ${formatWholeNumber(annualUsageKwh)} kWh/year household use`;
  const solarUseLabel = primaryFullCapture ? 'Solar Value Captured' : 'Solar Used In Home';
  const solarUseSublabel = primaryFullCapture
    ? '100% of yearly generation is treated as usable in the best-case model'
    : `${Math.round(headlineValueModel.selfUseRatio * 100)}% of yearly generation in the best-case model`;
  const gridFlowValue = primaryFullCapture ? '100%' : `${Math.round(headlineValueModel.exportKwh)} kWh`;
  const gridFlowRange = primaryFullCapture ? 'No unpaid spill modelled' : `Modelled range: ${spillRange}`;
  const gridFlowIcon = primaryFullCapture ? '🛡️' : '🔌';

  hideLoadingState();

  document.getElementById('recommendation-card').innerHTML = `
    <div class="results-hero-grid">
      <div>
        <div class="results-kicker">Quote Summary</div>
        <h3 class="results-hero-title">${safeKitName} on ${safeSelectedSpaceName}</h3>
        <p class="recommendation-text">
          Pricing this setup facing <strong>${escapeHtml(getCompassDirection(selectedSpace.orientation || 180))}</strong> at
          <strong>${selectedSpace.tilt || 35}°</strong> tilt.
          In the strongest case this setup could produce <strong>${formatWholeNumber(headlineAdjusted.annualKwh)} kWh</strong> in year one, with the current shade model giving a broader range of
          <strong>${firstYearGenerationRange}</strong>.
          ${annualValueCopy}
        </p>
        <div class="analysis-note" style="margin-bottom: 14px;">${usageContextCopy}</div>
        <div class="analysis-note" style="margin-bottom: 14px;">Direct-sun scores are a shading signal, not a straight energy conversion. Year-one kWh still depends on the selected facing and tilt as well as the shade model.</div>
        <div class="analysis-note" style="margin-bottom: 14px;">Kit cost in this quote is <strong>${formatCurrency(headlineRoi.kitCost)}</strong>. ${escapeHtml(kitPriceStatus)}. ${escapeHtml(kitPriceDetail)}</div>
        <div class="badge-row" style="margin: 14px 0 10px;">
          <span class="info-badge">${kit.hasBattery ? 'Battery combo selected' : 'Solar-only kit selected'}</span>
          <span class="info-badge">Confidence: ${safeConfidence}</span>
          <span class="info-badge">Shadow factor: ${Math.round((selectedSpace.shadowFactor || adjusted.shadowFactor) * 100)}%</span>
        </div>
        ${batterySpillNote}
        ${warningsHtml}
        ${selectionNote}
      </div>
      <div class="results-hero-stat">
        <div class="results-hero-stat-label">Best-Case First-Year Value</div>
        <div class="results-hero-stat-value">${formatCurrency(headlineValueModel.annualValue)}</div>
        <div class="results-hero-stat-range">Modelled range: ${firstYearValueRange}</div>
        <div class="results-hero-stat-note">${heroStatNote}</div>
      </div>
    </div>
  `;

  document.getElementById('results-grid').innerHTML = `
    <div class="card result-card">
      <div class="result-icon">⚡</div>
      <div class="result-value accent">${formatWholeNumber(headlineAdjusted.annualKwh)}</div>
      <div class="result-label">Best-Case kWh / year</div>
      <div class="result-range-note">Modelled range: ${firstYearGenerationRange}</div>
      <div class="result-sublabel">Upper-end output at current shading estimate</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">💷</div>
      <div class="result-value accent">${formatCurrency(headlineValueModel.annualValue)}</div>
      <div class="result-label">Best-Case First-Year Value</div>
      <div class="result-range-note">Modelled range: ${firstYearValueRange}</div>
      <div class="result-sublabel">${valueBreakdownCopy}</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">⏱️</div>
      <div class="result-value success">${formatPayback(headlineRoi.paybackYears)}</div>
      <div class="result-label">Fastest Modelled Payback</div>
      <div class="result-range-note">Modelled range: ${paybackRange}</div>
      <div class="result-sublabel">Upfront cost: ${formatCurrency(headlineRoi.kitCost)} · ${escapeHtml(kitPriceStatus)}</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">📈</div>
      <div class="result-value accent">${formatCurrency(headlineRoi.netReturn25yr)}</div>
      <div class="result-label">Best-Case 25-Year Net Return</div>
      <div class="result-range-note">Modelled range: ${netReturnRange}</div>
      <div class="result-sublabel">${headlineRoi.roiPercent}% ROI</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">🏠</div>
      <div class="result-value success">${Math.round(headlineValueModel.selfUsedKwh)} kWh</div>
      <div class="result-label">${solarUseLabel}</div>
      <div class="result-range-note">Modelled range: ${selfUseRange}</div>
      <div class="result-sublabel">${solarUseSublabel}</div>
    </div>
    ${smartTariffIncluded ? `
    <div class="card result-card">
      <div class="result-icon">🕒</div>
      <div class="result-value success">${formatCurrency(headlineValueModel.smartTariffSavings)}</div>
      <div class="result-label">Smart Tariff Value</div>
      <div class="result-range-note">Modelled range: ${formatCurrencyRange(conservativeValueModel.smartTariffSavings, optimisticValueModel.smartTariffSavings)}</div>
      <div class="result-sublabel">${Math.round(headlineValueModel.smartTariffShiftKwh)} kWh shifted from low-rate charging in the best-case model</div>
    </div>` : ''}
    <div class="card result-card">
      <div class="result-icon">${gridFlowIcon}</div>
      <div class="result-value accent">${gridFlowValue}</div>
      <div class="result-label">${gridSpillLabel}</div>
      <div class="result-range-note">${gridFlowRange}</div>
      <div class="result-sublabel">${gridSpillCopy}</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">🧭</div>
      <div class="result-value accent">${safeConfidence}</div>
      <div class="result-label">Confidence</div>
      <div class="result-sublabel">${safeRelativeDirection}</div>
    </div>
  `;

  renderBatteryUpgrade(primaryScenario, upgradeScenario);
  renderResultActions(primaryScenario);

  animateCounters();
  renderMonthlyChart(adjusted, solarData);
  renderSavingsChart(roi);

  const spillDisclaimerCopy = primaryFullCapture
    ? 'This quote assumes all generated solar is captured and valued at the selected import rate, with no unpaid spill.'
    : exportPaymentEnabled
      ? ''
      : 'This plug-in solar quote assumes excess electricity sent to the grid is unpaid.';
  document.getElementById('price-disclaimer').textContent = exportPaymentEnabled
    ? `Based on ${pricing.sourceDetail}. The quote is currently using ${formatRatePence(pricing.unitRatePence)}${config.electricityPriceUnit}${pricing.standingChargePence != null ? `, with a regional standing charge reference of ${formatRatePence(pricing.standingChargePence)}p/day shown for context only.` : '.'} Household usage is set to ${formatWholeNumber(annualUsageKwh)} kWh/year${usingDefaultAnnualUsage ? ` using the UK typical default from ${DEFAULT_ANNUAL_USAGE_SOURCE}` : ''}. Kit cost is ${formatCurrency(headlineRoi.kitCost)} from ${kitPriceStatus.toLowerCase()}. ${kitPriceDetail} Headline tiles show the best-case modelled outcome and smaller text shows the wider range.${spillDisclaimerCopy ? ` ${spillDisclaimerCopy}` : ''}${smartTariffIncluded ? ` Smart-tariff battery shifting is estimated using ${config.smartTariffOffPeakPrice}${config.smartTariffOffPeakPriceUnit} overnight import from ${config.smartTariffSource}.` : ''} ${storageAssumptionCopy}${annualValueGrowthCopy ? ` ${annualValueGrowthCopy}` : ''}`
    : `Based on ${pricing.sourceDetail}. The quote is currently using ${formatRatePence(pricing.unitRatePence)}${config.electricityPriceUnit}${pricing.standingChargePence != null ? `, with a regional standing charge reference of ${formatRatePence(pricing.standingChargePence)}p/day shown for context only.` : '.'} Household usage is set to ${formatWholeNumber(annualUsageKwh)} kWh/year${usingDefaultAnnualUsage ? ` using the UK typical default from ${DEFAULT_ANNUAL_USAGE_SOURCE}` : ''}. Kit cost is ${formatCurrency(headlineRoi.kitCost)} from ${kitPriceStatus.toLowerCase()}. ${kitPriceDetail} Headline tiles show the best-case modelled outcome and smaller text shows the wider range. ${spillDisclaimerCopy}${smartTariffIncluded ? ` Smart-tariff battery shifting is estimated using ${config.smartTariffOffPeakPrice}${config.smartTariffOffPeakPriceUnit} overnight import from ${config.smartTariffSource}.` : ''} ${storageAssumptionCopy}${annualValueGrowthCopy ? ` ${annualValueGrowthCopy}` : ''}`;

  updateAssumptionUi();
}

function ensureResultsStickyActions() {
  let stickyActionsEl = document.getElementById(RESULTS_STICKY_ACTIONS_ID);
  if (stickyActionsEl) return stickyActionsEl;

  stickyActionsEl = document.createElement('div');
  stickyActionsEl.id = RESULTS_STICKY_ACTIONS_ID;
  stickyActionsEl.className = 'results-sticky-actions';
  stickyActionsEl.setAttribute('aria-live', 'polite');
  stickyActionsEl.setAttribute('data-results-portal', 'true');
  document.body.appendChild(stickyActionsEl);
  return stickyActionsEl;
}

function removeResultsStickyActions() {
  const stickyActionsEl = document.getElementById(RESULTS_STICKY_ACTIONS_ID);
  if (stickyActionsEl?.dataset.resultsPortal === 'true') {
    stickyActionsEl.remove();
  } else if (stickyActionsEl) {
    stickyActionsEl.innerHTML = '';
  }
}

function renderBatteryUpgrade(primaryScenario, upgradeScenario) {
  const slot = document.getElementById('battery-upgrade-slot');
  if (!slot) return;
  const primaryFullCapture = usesFullSolarCapture(primaryScenario.kit);
  const exportPaymentEnabled = hasExportPayment();
  const smartTariffIncluded = primaryScenario.valueModel.smartTariffSavings > 0;

  if (primaryScenario.kit.hasBattery) {
    slot.innerHTML = `
      <div class="card battery-upgrade-card battery-upgrade-live">
      <div class="battery-upgrade-eyebrow">Battery Included</div>
        <h3 class="battery-upgrade-title">${escapeHtml(primaryScenario.kit.name)} already includes storage</h3>
        <p class="battery-upgrade-copy">
          ${primaryFullCapture
    ? `This setup is modelled with full solar capture, so the quote treats all <strong>${Math.round(primaryScenario.valueModel.selfUsedKwh)} kWh/year</strong> of yearly solar generation as captured value.`
    : `This setup is expected to keep around <strong>${Math.round(primaryScenario.valueModel.selfUsedKwh)} kWh/year</strong> on-site and leave roughly <strong>${Math.round(primaryScenario.valueModel.exportKwh)} kWh/year</strong> as remaining solar spill after the battery has shifted some midday solar into later household use.`}
          ${smartTariffIncluded ? `It also includes about <strong>${formatCurrency(primaryScenario.valueModel.smartTariffSavings)}</strong> of year-one value from cheap-rate charging and peak-time discharge on a smart tariff.` : ''}
        </p>
        <div class="battery-upgrade-metrics">
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${(primaryScenario.kit.batteryCapacityWh / 1000).toFixed(1)}kWh</div>
            <div class="battery-upgrade-label">Battery size</div>
          </div>
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${Math.round(primaryScenario.valueModel.shiftedKwh)} kWh</div>
            <div class="battery-upgrade-label">Solar shifted later</div>
          </div>
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${smartTariffIncluded ? formatCurrency(primaryScenario.valueModel.smartTariffSavings) : primaryFullCapture ? '100%' : `${Math.round(primaryScenario.valueModel.exportKwh)} kWh`}</div>
            <div class="battery-upgrade-label">${smartTariffIncluded ? 'Smart tariff value' : primaryFullCapture ? 'Solar capture active' : exportPaymentEnabled ? 'Still exported' : 'Remaining spill'}</div>
          </div>
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${formatPayback(primaryScenario.roi.paybackYears)}</div>
            <div class="battery-upgrade-label">Estimated payback</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (!upgradeScenario) {
    slot.innerHTML = '';
    return;
  }

  const annualValueGain = upgradeScenario.valueModel.annualValue - primaryScenario.valueModel.annualValue;
  const selfUseGain = upgradeScenario.valueModel.selfUsedKwh - primaryScenario.valueModel.selfUsedKwh;
  const exportReduction = primaryScenario.valueModel.exportKwh - upgradeScenario.valueModel.exportKwh;
  const costDelta = upgradeScenario.kit.price - primaryScenario.kit.price;
  const smartTariffGain = upgradeScenario.valueModel.smartTariffSavings - primaryScenario.valueModel.smartTariffSavings;
  const upgradeHasSmartTariff = smartTariffGain > 0;
  const upgradeLink = resolveRetailerLink(upgradeScenario.kit.storeUrl);

  slot.innerHTML = `
    <div class="card battery-upgrade-card">
      <div class="battery-upgrade-eyebrow">Recover Lost Solar Value</div>
      <h3 class="battery-upgrade-title">Add ${escapeHtml(upgradeScenario.kit.name)}</h3>
      <p class="battery-upgrade-copy">
        With the solar-only setup, the model expects around <strong>${Math.round(primaryScenario.valueModel.exportKwh)} kWh/year</strong> to leave the home unused.
        Because this quote assumes no payment for that excess, the matched battery combo could recover roughly
        <strong>${formatCurrency(annualValueGain)}</strong> of otherwise lost year-one value by lifting on-site use by about
        <strong>${Math.round(selfUseGain)} kWh/year</strong>${upgradeHasSmartTariff ? ` and adding about <strong>${formatCurrency(smartTariffGain)}</strong> of smart-tariff battery shifting from low-rate charging and peak-time discharge` : ''}.
      </p>
      <div class="battery-upgrade-metrics">
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${formatCurrency(annualValueGain)}</div>
          <div class="battery-upgrade-label">Year-one value lift</div>
        </div>
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${Math.round(selfUseGain)} kWh</div>
          <div class="battery-upgrade-label">More solar kept on-site</div>
        </div>
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${upgradeHasSmartTariff ? formatCurrency(smartTariffGain) : Math.round(exportReduction)}${upgradeHasSmartTariff ? '' : ' kWh'}</div>
          <div class="battery-upgrade-label">${upgradeHasSmartTariff ? 'Smart tariff value' : 'Less unpaid spill'}</div>
        </div>
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${formatCurrency(costDelta)}</div>
          <div class="battery-upgrade-label">Extra upfront spend</div>
        </div>
      </div>
      <div class="battery-upgrade-note">
        Estimated payback for the upgrade path: <strong>${formatPayback(upgradeScenario.roi.paybackYears)}</strong>.
        ${exportPaymentEnabled
    ? `It would still export about <strong>${Math.round(upgradeScenario.valueModel.exportKwh)} kWh/year</strong>, worth roughly
        <strong>${formatCurrency(upgradeScenario.valueModel.exportIncome)}</strong> in year one.`
    : `With the battery combo selected, this model assumes the solar spill is captured on-site rather than left unpaid.${upgradeHasSmartTariff ? ` It also includes about <strong>${formatCurrency(smartTariffGain)}</strong> of low-rate charging and peak-time discharge value where the battery kit supports it.` : ''}`}
      </div>
      <div class="result-actions">
        <button class="btn btn-primary" id="btn-switch-battery" data-kit-id="${safeDataId(upgradeScenario.kit.id)}">
          Use Battery Combo In This Quote
        </button>
        ${renderExternalAction(
          upgradeLink,
          upgradeLink.usesAffiliateLink ? 'View Battery Partner Offer →' : 'View Battery Combo →',
          'btn btn-outline'
        )}
      </div>
    </div>
  `;

  document.getElementById('btn-switch-battery')?.addEventListener('click', () => {
    setState({ selectedKit: upgradeScenario.kit });
    resetResultsForRecalculation();
    calculateResults();
  });
}

function renderResultActions(primaryScenario) {
  const actionsEl = document.getElementById('results-actions');
  const stickyActionsEl = ensureResultsStickyActions();
  if (!actionsEl) return;
  const primaryLink = resolveRetailerLink(primaryScenario.kit.storeUrl);
  const actionLabel = primaryLink.usesAffiliateLink ? 'View Partner Offer →' : `View ${primaryScenario.kit.brand || 'Retailer'} Store →`;
  const actionHtml = renderExternalAction(primaryLink, actionLabel, 'btn btn-primary');

  actionsEl.innerHTML = `
    <div class="result-actions">
      ${actionHtml}
      <button class="btn btn-outline" id="btn-recalc-results">
        Refresh This Quote
      </button>
    </div>
  `;

  if (stickyActionsEl) {
    stickyActionsEl.innerHTML = `
      <div class="results-sticky-copy">
        <strong>${escapeHtml(primaryScenario.kit.name)}</strong>
        <span>Ready to buy or compare the recommended partner kit.</span>
      </div>
      <div class="results-sticky-buttons">
        ${actionHtml}
      </div>
    `;
  }

  document.getElementById('btn-recalc-results')?.addEventListener('click', () => {
    resetResultsForRecalculation();
    calculateResults();
  });

  document.getElementById('btn-sticky-refresh-results')?.addEventListener('click', () => {
    resetResultsForRecalculation();
    calculateResults();
  });
}

function renderMonthlyChart(adjusted, solarData) {
  const ctx = document.getElementById('chart-monthly');
  if (!ctx) return;

  const monthlyData = buildMonthlyChartData(adjusted, solarData);
  const labels = monthlyData.map((month) => month.monthName);
  const data = monthlyData.map((month) => month.adjustedKwh);

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'kWh Generated',
        data,
        backgroundColor: data.map((value) => {
          const intensity = value / Math.max(...data);
          return `rgba(245, 158, 11, ${0.3 + intensity * 0.7})`;
        }),
        borderColor: 'rgba(245, 158, 11, 1)',
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1E293B',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          borderColor: 'rgba(245,158,11,0.3)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (context) => `${context.parsed.y} kWh`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748B', font: { family: 'Inter' } },
          grid: { display: false },
        },
        y: {
          ticks: { color: '#64748B', font: { family: 'Inter' }, callback: (value) => `${value} kWh` },
          grid: { color: 'rgba(148,163,184,0.08)' },
        },
      },
    },
  });

  charts.push(chart);
}

function buildMonthlyChartData(adjusted = {}, solarData = {}) {
  if (Array.isArray(adjusted.months) && adjusted.months.length > 0) {
    return adjusted.months.map((month, index) => ({
      monthName: month.monthName || getMonthShortName(index),
      adjustedKwh: Number.isFinite(month.adjustedKwh) ? month.adjustedKwh : 0,
    }));
  }

  const sourceMonths = Array.isArray(solarData.months) && solarData.months.length > 0
    ? solarData.months
    : MONTH_NAMES.map((monthName, index) => ({ monthName, kwhPerKwp: 1, month: index + 1 }));
  const sourceTotal = sourceMonths.reduce((sum, month) => sum + getMonthWeight(month), 0);
  const annualKwh = Number.isFinite(adjusted.annualKwh) ? adjusted.annualKwh : 0;
  const equalShare = sourceMonths.length > 0 ? annualKwh / sourceMonths.length : 0;

  return sourceMonths.map((month, index) => {
    const weight = getMonthWeight(month);
    const adjustedKwh = sourceTotal > 0
      ? annualKwh * (weight / sourceTotal)
      : equalShare;

    return {
      monthName: month.monthName || getMonthShortName(index),
      adjustedKwh: Math.round(adjustedKwh * 10) / 10,
    };
  });
}

function getMonthWeight(month) {
  const candidates = [month.adjustedKwh, month.kwhPerKwp, month.kwh, month.energy, month.avgDailyKwh];
  const value = candidates.find(Number.isFinite);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getMonthShortName(index) {
  return MONTH_NAMES[index] || `M${index + 1}`;
}

function renderSavingsChart(roi) {
  const ctx = document.getElementById('chart-savings');
  if (!ctx) return;

  const labels = roi.yearlyData.map((year) => `Year ${year.year}`);
  const cumSavings = roi.yearlyData.map((year) => year.cumulativeSavings);
  const kitCostLine = roi.yearlyData.map(() => roi.kitCost);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Cumulative Value',
          data: cumSavings,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
        {
          label: 'Upfront Cost',
          data: kitCostLine,
          borderColor: 'rgba(239, 68, 68, 0.5)',
          borderWidth: 2,
          borderDash: [8, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94A3B8', font: { family: 'Inter' }, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: '#1E293B',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          borderColor: 'rgba(16,185,129,0.3)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (context) => `${context.dataset.label}: £${context.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748B', font: { family: 'Inter' }, maxTicksLimit: 10 },
          grid: { display: false },
        },
        y: {
          ticks: { color: '#64748B', font: { family: 'Inter' }, callback: (value) => `£${value}` },
          grid: { color: 'rgba(148,163,184,0.08)' },
        },
      },
    },
  });

  charts.push(chart);
}

function initAssumptionControls() {
  document.getElementById('btn-apply-usage')?.addEventListener('click', () => {
    applyAnnualUsageInput();
  });

  document.getElementById('btn-use-average-usage')?.addEventListener('click', () => {
    const input = document.getElementById('annual-usage-input');
    if (input) {
      input.value = '';
      input.setCustomValidity('');
    }

    setState({ annualUsageKwh: null, results: null });
    updateAssumptionUi();
    resetResultsForRecalculation();
    calculateResults();
  });

  document.getElementById('annual-usage-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyAnnualUsageInput();
    }
  });

  document.getElementById('btn-apply-electricity-price')?.addEventListener('click', () => {
    applyElectricityPriceInput();
  });

  document.getElementById('btn-use-smart-price')?.addEventListener('click', () => {
    const input = document.getElementById('electricity-price-input');
    if (input) {
      input.value = '';
      input.setCustomValidity('');
    }

    setState({ electricityPricePence: null, results: null });
    updateAssumptionUi();
    resetResultsForRecalculation();
    calculateResults();
  });

  document.getElementById('electricity-price-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyElectricityPriceInput();
    }
  });
}

function applyAnnualUsageInput() {
  const input = document.getElementById('annual-usage-input');
  if (!input) return;

  const rawValue = input.value.trim();
  if (!rawValue) {
    input.setCustomValidity('');
    setState({ annualUsageKwh: null, results: null });
    updateAssumptionUi();
    resetResultsForRecalculation();
    calculateResults();
    return;
  }

  const annualUsageKwh = Number(rawValue);
  if (!Number.isFinite(annualUsageKwh) || annualUsageKwh < 100 || annualUsageKwh > 100000) {
    input.setCustomValidity('Enter a yearly electricity use between 100 and 100,000 kWh, or leave it blank to use the UK average.');
    input.reportValidity();
    return;
  }

  input.setCustomValidity('');
  setState({ annualUsageKwh: Math.round(annualUsageKwh), results: null });
  updateAssumptionUi();
  resetResultsForRecalculation();
  calculateResults();
}

function updateUsageAssumptionUi() {
  const annualUsageInput = getAnnualUsageInput();
  const resolvedAnnualUsage = getResolvedAnnualUsageKwh();
  const usingDefaultAnnualUsage = isUsingDefaultAnnualUsage();
  const selectedKit = resolveSelectedKit(getState('selectedKit'));

  const pill = document.getElementById('annual-usage-pill');
  if (pill) {
    pill.textContent = usingDefaultAnnualUsage ? 'UK average active' : 'Custom value active';
  }

  const input = document.getElementById('annual-usage-input');
  if (input && document.activeElement !== input) {
    input.value = annualUsageInput ?? '';
  }

  const helper = document.getElementById('annual-usage-helper');
  if (helper) {
    helper.textContent = getAnnualUsageHelperText(usingDefaultAnnualUsage, resolvedAnnualUsage, selectedKit);
  }

  const source = document.getElementById('annual-usage-source');
  if (source) {
    source.textContent = usingDefaultAnnualUsage ? DEFAULT_ANNUAL_USAGE_SOURCE : 'Using your household estimate';
  }

  const effective = document.getElementById('annual-usage-effective');
  if (effective) {
    effective.textContent = `${formatWholeNumber(resolvedAnnualUsage)} kWh/year`;
  }
}

function applyElectricityPriceInput() {
  const input = document.getElementById('electricity-price-input');
  if (!input) return;

  const rawValue = input.value.trim();
  if (!rawValue) {
    input.setCustomValidity('');
    setState({ electricityPricePence: null, results: null });
    updateAssumptionUi();
    resetResultsForRecalculation();
    calculateResults();
    return;
  }

  const electricityPricePence = normalizeCustomUnitRatePence(rawValue);
  if (!Number.isFinite(electricityPricePence)) {
    input.setCustomValidity('Enter an electricity price between 1 and 100 p/kWh, or leave it blank to use the postcode-based default.');
    input.reportValidity();
    return;
  }

  input.setCustomValidity('');
  setState({ electricityPricePence, results: null });
  updateAssumptionUi();
  resetResultsForRecalculation();
  calculateResults();
}

function updatePricingAssumptionUi() {
  const pricing = getResolvedElectricityPricing();
  const electricityPriceInput = getElectricityPriceInput();
  const usingCustomElectricityPrice = isUsingCustomElectricityPrice();

  const pill = document.getElementById('electricity-price-pill');
  if (pill) {
    pill.textContent = getElectricityPricePillText(pricing, usingCustomElectricityPrice);
  }

  const input = document.getElementById('electricity-price-input');
  if (input && document.activeElement !== input) {
    input.value = electricityPriceInput ?? '';
  }

  const helper = document.getElementById('electricity-price-helper');
  if (helper) {
    helper.textContent = getElectricityPriceHelperText(pricing, usingCustomElectricityPrice);
  }

  const source = document.getElementById('electricity-price-source');
  if (source) {
    source.textContent = pricing.source;
  }

  const effective = document.getElementById('electricity-price-effective');
  if (effective) {
    effective.textContent = `${formatRatePence(pricing.unitRatePence)} p/kWh`;
  }

  const detail = document.getElementById('electricity-price-detail');
  if (detail) {
    detail.textContent = getElectricityPriceDetailText(pricing);
  }
}

function updateAssumptionUi() {
  updateUsageAssumptionUi();
  updatePricingAssumptionUi();
}

function getAnnualUsageHelperText(usingDefaultAnnualUsage, annualUsageKwh, selectedKit = resolveSelectedKit(getState('selectedKit'))) {
  const fullCaptureWithStorage = usesFullSolarCapture(selectedKit);

  return usingDefaultAnnualUsage
    ? fullCaptureWithStorage
      ? `Leave this blank to keep the UK typical household default of ${formatWholeNumber(DEFAULT_ANNUAL_USAGE_KWH)} kWh/year. With full solar capture turned on, this mainly fine-tunes storage and smart-tariff assumptions.`
      : `Leave this blank to keep the UK typical household default of ${formatWholeNumber(DEFAULT_ANNUAL_USAGE_KWH)} kWh/year. Higher home use usually means more of the solar stays valuable on-site.`
    : fullCaptureWithStorage
      ? `The quote is currently using ${formatWholeNumber(annualUsageKwh)} kWh/year. With full solar capture turned on, this mainly fine-tunes storage and smart-tariff assumptions.`
      : `The quote is currently using ${formatWholeNumber(annualUsageKwh)} kWh/year to split generation between home use and spill. Clear the field or use the UK average button if you do not know your number yet.`;
}

function getElectricityPriceHelperText(pricing, usingCustomElectricityPrice) {
  if (usingCustomElectricityPrice) {
    return `The quote is currently using your custom import rate of ${formatRatePence(pricing.unitRatePence)} p/kWh. Clear the field or use Postcode Default to return to the postcode-based regional average.`;
  }

  if (pricing.mode === 'regional') {
    return `Your saved location maps to Ofgem's ${pricing.region} region, so the quote is using ${formatRatePence(pricing.unitRatePence)} p/kWh by default. Enter your real tariff for a tighter estimate.`;
  }

  return `We could not confidently infer an Ofgem region from the saved location, so the quote is using the Great Britain average of ${formatRatePence(pricing.unitRatePence)} p/kWh. Enter your real tariff for a tighter estimate.`;
}

function getElectricityPriceDetailText(pricing) {
  if (pricing.mode === 'regional' && pricing.standingChargePence != null) {
    return `${pricing.region} standing charge reference: ${formatRatePence(pricing.standingChargePence)} p/day. Daily standing charges are not included in solar savings.`;
  }

  if (pricing.mode === 'custom') {
    return 'Custom unit rate active. Daily standing charges are not included in solar savings.';
  }

  return 'Great Britain average fallback. Daily standing charges are not included in solar savings.';
}

function getElectricityPricePillText(pricing, usingCustomElectricityPrice) {
  if (usingCustomElectricityPrice) {
    return 'Custom tariff active';
  }

  if (pricing.mode === 'regional' && pricing.region) {
    return `${pricing.region} average active`;
  }

  return 'GB average active';
}

function getBatteryUpgradeKit(selectedKit, livePricing = null, spaceType = null) {
  if (!selectedKit || selectedKit.hasBattery) return null;

  const upgradeKit = kitsData.find((kit) => (
    kit.hasBattery
    && kit.brand === selectedKit.brand
    && kit.wattage === selectedKit.wattage
  )) || null;

  return upgradeKit
    ? findPricedKitById(upgradeKit.id, livePricing, { spaceType })
    : null;
}

function resolveSelectedKit(selectedKit, livePricing = null, spaceType = null) {
  return findPricedKitById(selectedKit, livePricing, { spaceType });
}

function animateCounters() {
  document.querySelectorAll('.result-value').forEach((element) => {
    element.style.animation = 'countUp 0.6s ease forwards';
  });
}

function hideLoadingState() {
  document.getElementById('results-loading')?.classList.add('hidden');
  document.getElementById('results-content')?.classList.remove('hidden');
}

function resetResultsForRecalculation() {
  calculationRequestId += 1;
  destroyCharts();
  removeResultsStickyActions();
  document.getElementById('results-content')?.classList.add('hidden');
  document.getElementById('results-loading')?.classList.remove('hidden');
}

function showError(message) {
  destroyCharts();
  removeResultsStickyActions();
  const loadingEl = document.getElementById('results-loading');
  if (!loadingEl) return;

  loadingEl.innerHTML = `
    <div style="color: var(--danger); font-size: 1.2rem; margin-bottom: 8px;">⚠️</div>
    <p>${escapeHtml(message)}</p>
    <button class="btn btn-secondary mt-md" id="btn-results-error-back">
      ← Go Back
    </button>
  `;
  document.getElementById('btn-results-error-back')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });
}

function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts = [];
}

function getCompassDirection(deg) {
  const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function capitalise(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatWholeNumber(value) {
  return Math.round(value || 0).toLocaleString('en-GB');
}

function formatRatePence(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function renderExternalAction(linkInfoOrUrl, label, className) {
  const linkInfo = typeof linkInfoOrUrl === 'string'
    ? { url: linkInfoOrUrl, usesAffiliateLink: false }
    : linkInfoOrUrl;
  const safeUrl = linkInfo?.usesAffiliateLink
    ? sanitizeExternalUrl(linkInfo?.url)
    : sanitizeExternalUrl(linkInfo?.url, { allowedHosts: ALLOWED_RETAILER_HOSTS });
  if (!safeUrl) {
    return `<button class="${className}" type="button" disabled>${escapeHtml(label)}</button>`;
  }

  return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="${className}">${escapeHtml(label)}</a>`;
}

function formatCurrencyRange(valueA, valueB) {
  return formatRangeText(valueA, valueB, formatCurrency, 0.5);
}

function formatPaybackRange(valueA, valueB) {
  return formatRangeText(valueA, valueB, formatPayback, 0.05);
}

function formatRangeText(valueA, valueB, formatter, tolerance = 0) {
  const range = getNumericRange(valueA, valueB);
  if (!range) {
    return 'Range unavailable';
  }

  if (Math.abs(range.max - range.min) <= tolerance) {
    return formatter(range.min);
  }

  return `${formatter(range.min)} to ${formatter(range.max)}`;
}

function getNumericRange(valueA, valueB) {
  const values = [valueA, valueB].filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function cleanup() {
  calculationRequestId += 1;
  destroyCharts();
  removeResultsStickyActions();
}
