import Chart from 'chart.js/auto';
import kitsData from '../data/kits.json';
import { getState, setState } from '../utils/state.js';
import { fetchSolarData, adjustForShadows } from '../utils/pvgis.js';
import { calculateROI, formatCurrency, formatPayback } from '../utils/roi.js';
import config from '../data/config.json';
import { escapeHtml, safeDataId, sanitizeExternalUrl } from '../utils/security.js';
import {
  DEFAULT_ANNUAL_USAGE_KWH,
  DEFAULT_ANNUAL_USAGE_SOURCE,
  getAnnualUsageInput,
  getLocationState,
  getRecommendedSpace,
  getResolvedAnnualUsageKwh,
  getSelectedOrRecommendedSpace,
  isUsingDefaultAnnualUsage,
} from '../utils/site-state.js';

let charts = [];
let calculationRequestId = 0;
const ALLOWED_RETAILER_HOSTS = [
  'uk.ecoflow.com',
  'thunderenergy.co.uk',
  'zendure.com',
  'www.anker.com',
  'anker.com',
];

export function render() {
  const annualUsageInput = getAnnualUsageInput();
  const resolvedAnnualUsage = getResolvedAnnualUsageKwh();
  const usingDefaultAnnualUsage = isUsingDefaultAnnualUsage();

  return `
    <div class="step-page scrollable">
      <div class="step-header">
        <div class="section-kicker">Step 6 · Results</div>
        <h2 class="step-title">Your Solar Blueprint</h2>
        <p class="step-subtitle">See the likely generation, value, lost spill profile, and whether a battery upgrade is worth pricing.</p>
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
                  <div class="analysis-note" id="annual-usage-helper">${getAnnualUsageHelperText(usingDefaultAnnualUsage, resolvedAnnualUsage)}</div>
                </div>
                <div class="results-usage-summary">
                  <div class="results-usage-summary-label" id="annual-usage-source">${usingDefaultAnnualUsage ? DEFAULT_ANNUAL_USAGE_SOURCE : 'Using your household estimate'}</div>
                  <div class="results-usage-summary-value" id="annual-usage-effective">${formatWholeNumber(resolvedAnnualUsage)} kWh/year</div>
                  <button class="btn btn-secondary" id="btn-use-average-usage" type="button">Use UK Average</button>
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

  initUsageControls();
  updateUsageAssumptionUi();
  calculateResults();
}

async function calculateResults() {
  const requestId = ++calculationRequestId;
  const location = getLocationState();
  const selectedKit = resolveSelectedKit(getState('selectedKit'));
  const selectedSpace = getSelectedOrRecommendedSpace() || {};
  const recommendedSpace = getRecommendedSpace() || selectedSpace;
  const annualUsageKwh = getResolvedAnnualUsageKwh();
  const usingDefaultAnnualUsage = isUsingDefaultAnnualUsage();

  if (!location || !selectedKit) {
    showError('Missing location or kit selection.');
    return;
  }

  try {
    const orientation = selectedSpace.orientation || 180;
    const pvgisAzimuth = orientation - 180;
    const tilt = selectedSpace.tilt || 35;

    const solarData = await fetchSolarData(location.lat, location.lng, tilt, pvgisAzimuth);
    if (requestId !== calculationRequestId) return;

    const baselineFactor = clamp(selectedSpace.shadowFactor ?? ((selectedSpace.avgDailyHours || 6) / 12), 0, 1);
    const conservativeFactor = clamp(selectedSpace.conservativeFactor ?? (baselineFactor - 0.14), 0, 1);
    const optimisticFactor = clamp(selectedSpace.optimisticFactor ?? (baselineFactor + 0.14), 0, 1);

    const primaryScenario = buildScenario(selectedKit, solarData, baselineFactor, conservativeFactor, optimisticFactor, annualUsageKwh);
    const batteryUpgradeKit = getBatteryUpgradeKit(selectedKit);
    const upgradeScenario = batteryUpgradeKit
      ? buildScenario(batteryUpgradeKit, solarData, baselineFactor, conservativeFactor, optimisticFactor, annualUsageKwh)
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
    });
  } catch (error) {
    if (requestId !== calculationRequestId) return;
    console.error('Results calculation failed:', error);
    showError('Failed to calculate results. Please try again.');
  }
}

function buildScenario(kit, solarData, baselineFactor, conservativeFactor, optimisticFactor, annualUsageKwh) {
  const adjusted = adjustForShadows(solarData, baselineFactor, kit.wattage);
  const conservativeAdjusted = adjustForShadows(solarData, conservativeFactor, kit.wattage);
  const optimisticAdjusted = adjustForShadows(solarData, optimisticFactor, kit.wattage);
  const valueModel = estimateEnergyValue(adjusted.annualKwh, kit, annualUsageKwh);
  const roi = calculateROI({
    kitCost: kit.price,
    annualKwh: adjusted.annualKwh,
    annualValuePerKwh: valueModel.effectiveValuePerKwh,
    warrantyYears: kit.warrantyYears,
  });

  return {
    kit,
    adjusted,
    conservativeAdjusted,
    optimisticAdjusted,
    valueModel,
    roi,
  };
}

function displayResults({ primaryScenario, upgradeScenario, selectedSpace, recommendedSpace, solarData, annualUsageKwh, usingDefaultAnnualUsage }) {
  const { kit, roi, adjusted, conservativeAdjusted, optimisticAdjusted, valueModel } = primaryScenario;
  const exportPaymentEnabled = hasExportPayment();
  const safeKitName = escapeHtml(kit.name);
  const safeSelectedSpaceName = escapeHtml(selectedSpace.name || 'your selected spot');
  const safeRecommendedSpaceName = escapeHtml(recommendedSpace.name || 'recommended spot');
  const safeConfidence = escapeHtml(capitalise(selectedSpace.confidence || 'medium'));
  const safeRelativeDirection = escapeHtml(selectedSpace.relativeDirectionLabel || 'Position estimated');
  const annualValueGain = upgradeScenario
    ? Math.max(0, upgradeScenario.valueModel.annualValue - valueModel.annualValue)
    : 0;
  const warningsHtml = (selectedSpace.warnings || [])
    .map((warning) => `<div style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(warning)}</div>`)
    .join('');
  const selectionNote = selectedSpace.id && recommendedSpace.id && selectedSpace.id !== recommendedSpace.id
    ? `<div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 8px;">This quote is using <strong>${safeSelectedSpaceName}</strong>. The model still ranks <strong>${safeRecommendedSpaceName}</strong> as the strongest sun location.</div>`
    : '';
  const usageContextCopy = usingDefaultAnnualUsage
    ? `No household usage was entered, so this quote is using the UK typical household default of <strong>${formatWholeNumber(annualUsageKwh)} kWh/year</strong> from ${escapeHtml(DEFAULT_ANNUAL_USAGE_SOURCE)}.`
    : `This quote is using your estimated household electricity use of <strong>${formatWholeNumber(annualUsageKwh)} kWh/year</strong> to work out how much solar stays on-site versus spills away unused.`;
  const annualValueCopy = exportPaymentEnabled
    ? `That is worth about <strong>${formatCurrency(valueModel.annualValue)}</strong> in year one, split between
      <strong>${formatCurrency(valueModel.billSavings)}</strong> of avoided grid spend and
      <strong>${formatCurrency(valueModel.exportIncome)}</strong> of export income.`
    : upgradeScenario && !kit.hasBattery
      ? `That is worth about <strong>${formatCurrency(valueModel.annualValue)}</strong> in year one from avoided grid spend.
      Without a battery, any excess sent back to the grid is lost value in this quote, and the matched battery could recover about
      <strong>${formatCurrency(annualValueGain)}</strong> of that in year one.`
      : `That is worth about <strong>${formatCurrency(valueModel.annualValue)}</strong> in year one from avoided grid spend.
      This plug-in solar quote assumes any excess sent back to the grid is unpaid.`;
  const valueBreakdownCopy = exportPaymentEnabled
    ? `${formatCurrency(valueModel.billSavings)} saved + ${formatCurrency(valueModel.exportIncome)} exported`
    : upgradeScenario && !kit.hasBattery
      ? `${formatCurrency(valueModel.billSavings)} bill reduction + up to ${formatCurrency(annualValueGain)} recoverable with storage`
      : `${formatCurrency(valueModel.billSavings)} bill reduction at current self-use assumptions`;
  const gridSpillLabel = exportPaymentEnabled
    ? 'Exported To Grid'
    : upgradeScenario && !kit.hasBattery
      ? 'Lost Value Without Battery'
      : 'Sent To Grid';
  const gridSpillCopy = exportPaymentEnabled
    ? `${formatCurrency(valueModel.exportIncome)} year-one export value`
    : upgradeScenario && !kit.hasBattery
      ? `${formatCurrency(annualValueGain)} year-one value could be recovered with a battery`
      : 'Assumed £0 export payment in this plug-in solar quote';

  hideLoadingState();

  document.getElementById('recommendation-card').innerHTML = `
    <div class="results-hero-grid">
      <div>
        <div class="results-kicker">Quote Summary</div>
        <h3 class="results-hero-title">${safeKitName} on ${safeSelectedSpaceName}</h3>
        <p class="recommendation-text">
          Pricing this setup facing <strong>${escapeHtml(getCompassDirection(selectedSpace.orientation || 180))}</strong> at
          <strong>${selectedSpace.tilt || 35}°</strong> tilt.
          The modelled first-year output is <strong>${roi.annualKwhYear1} kWh</strong>, with a more honest expected range of
          <strong>${conservativeAdjusted.annualKwh}-${optimisticAdjusted.annualKwh} kWh/year</strong>.
          ${annualValueCopy}
        </p>
        <div class="analysis-note" style="margin-bottom: 14px;">${usageContextCopy}</div>
        <div class="badge-row" style="margin: 14px 0 10px;">
          <span class="info-badge">${kit.hasBattery ? 'Battery combo selected' : 'Solar-only kit selected'}</span>
          <span class="info-badge">Confidence: ${safeConfidence}</span>
          <span class="info-badge">Shadow factor: ${Math.round((selectedSpace.shadowFactor || adjusted.shadowFactor) * 100)}%</span>
        </div>
        ${warningsHtml}
        ${selectionNote}
      </div>
      <div class="results-hero-stat">
        <div class="results-hero-stat-label">Modelled first-year value</div>
        <div class="results-hero-stat-value">${formatCurrency(valueModel.annualValue)}</div>
        <div class="results-hero-stat-note">${Math.round(valueModel.selfUsedKwh)} kWh used in home · ${Math.round(valueModel.exportKwh)} kWh spill · ${formatWholeNumber(annualUsageKwh)} kWh/year household use</div>
      </div>
    </div>
  `;

  document.getElementById('results-grid').innerHTML = `
    <div class="card result-card">
      <div class="result-icon">⚡</div>
      <div class="result-value accent">${conservativeAdjusted.annualKwh}-${optimisticAdjusted.annualKwh}</div>
      <div class="result-label">kWh / year</div>
      <div class="result-sublabel">Conservative to optimistic</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">💷</div>
      <div class="result-value accent">${formatCurrency(valueModel.annualValue)}</div>
      <div class="result-label">First-Year Value</div>
      <div class="result-sublabel">${valueBreakdownCopy}</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">⏱️</div>
      <div class="result-value success">${formatPayback(roi.paybackYears)}</div>
      <div class="result-label">Payback Period</div>
      <div class="result-sublabel">Upfront cost: ${formatCurrency(roi.kitCost)}</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">📈</div>
      <div class="result-value accent">${formatCurrency(roi.netReturn25yr)}</div>
      <div class="result-label">25-Year Net Return</div>
      <div class="result-sublabel">${roi.roiPercent}% ROI</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">🏠</div>
      <div class="result-value success">${Math.round(valueModel.selfUsedKwh)} kWh</div>
      <div class="result-label">Used In Your Home</div>
      <div class="result-sublabel">${Math.round(valueModel.selfUseRatio * 100)}% of yearly generation</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">🔌</div>
      <div class="result-value accent">${Math.round(valueModel.exportKwh)} kWh</div>
      <div class="result-label">${gridSpillLabel}</div>
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

  document.getElementById('price-disclaimer').textContent = exportPaymentEnabled
    ? `Based on ${config.electricityPriceSource}: ${config.electricityPrice}${config.electricityPriceUnit}, plus ${config.exportTariff}${config.exportTariffUnit} from ${config.exportTariffSource}. Household usage is set to ${formatWholeNumber(annualUsageKwh)} kWh/year${usingDefaultAnnualUsage ? ` using the UK typical default from ${DEFAULT_ANNUAL_USAGE_SOURCE}` : ''}. The storage comparison assumes ${Math.round(config.solarSelfUseRatio * 100)}% direct self-use without a battery and ${Math.round(config.batteryRoundTripEfficiency * 100)}% round-trip storage efficiency.`
    : `Based on ${config.electricityPriceSource}: ${config.electricityPrice}${config.electricityPriceUnit}. Household usage is set to ${formatWholeNumber(annualUsageKwh)} kWh/year${usingDefaultAnnualUsage ? ` using the UK typical default from ${DEFAULT_ANNUAL_USAGE_SOURCE}` : ''}. This plug-in solar quote assumes excess electricity sent to the grid is unpaid. The storage comparison assumes ${Math.round(config.solarSelfUseRatio * 100)}% direct self-use without a battery and ${Math.round(config.batteryRoundTripEfficiency * 100)}% round-trip storage efficiency.`;

  updateUsageAssumptionUi();
}

function renderBatteryUpgrade(primaryScenario, upgradeScenario) {
  const slot = document.getElementById('battery-upgrade-slot');
  if (!slot) return;
  const exportPaymentEnabled = hasExportPayment();

  if (primaryScenario.kit.hasBattery) {
    slot.innerHTML = `
      <div class="card battery-upgrade-card battery-upgrade-live">
      <div class="battery-upgrade-eyebrow">Battery Included</div>
        <h3 class="battery-upgrade-title">${escapeHtml(primaryScenario.kit.name)} already includes storage</h3>
        <p class="battery-upgrade-copy">
          This setup is expected to keep around <strong>${Math.round(primaryScenario.valueModel.selfUsedKwh)} kWh/year</strong> on-site and
          leave roughly <strong>${Math.round(primaryScenario.valueModel.exportKwh)} kWh/year</strong> as remaining spill after the battery has shifted some midday solar into later household use.
        </p>
        <div class="battery-upgrade-metrics">
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${(primaryScenario.kit.batteryCapacityWh / 1000).toFixed(1)}kWh</div>
            <div class="battery-upgrade-label">Battery size</div>
          </div>
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${Math.round(primaryScenario.valueModel.shiftedKwh)} kWh</div>
            <div class="battery-upgrade-label">Shifted into later use</div>
          </div>
          <div class="battery-upgrade-metric">
            <div class="battery-upgrade-value">${Math.round(primaryScenario.valueModel.exportKwh)} kWh</div>
            <div class="battery-upgrade-label">${exportPaymentEnabled ? 'Still exported' : 'Remaining spill'}</div>
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

  slot.innerHTML = `
    <div class="card battery-upgrade-card">
      <div class="battery-upgrade-eyebrow">Recover Lost Solar Value</div>
      <h3 class="battery-upgrade-title">Add ${escapeHtml(upgradeScenario.kit.name)}</h3>
      <p class="battery-upgrade-copy">
        With the solar-only setup, the model expects around <strong>${Math.round(primaryScenario.valueModel.exportKwh)} kWh/year</strong> to leave the home unused.
        Because this quote assumes no payment for that excess, the matched battery combo could recover roughly
        <strong>${formatCurrency(annualValueGain)}</strong> of otherwise lost year-one value by lifting on-site use by about
        <strong>${Math.round(selfUseGain)} kWh/year</strong>.
      </p>
      <div class="battery-upgrade-metrics">
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${formatCurrency(annualValueGain)}</div>
          <div class="battery-upgrade-label">Recovered year-one value</div>
        </div>
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${Math.round(selfUseGain)} kWh</div>
          <div class="battery-upgrade-label">More solar kept on-site</div>
        </div>
        <div class="battery-upgrade-metric">
          <div class="battery-upgrade-value">${Math.round(exportReduction)} kWh</div>
          <div class="battery-upgrade-label">Less unpaid spill</div>
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
    : `It would still leave about <strong>${Math.round(upgradeScenario.valueModel.exportKwh)} kWh/year</strong> as spill, but this quote assumes no payment for that excess.`}
      </div>
      <div class="result-actions">
        <button class="btn btn-primary" id="btn-switch-battery" data-kit-id="${safeDataId(upgradeScenario.kit.id)}">
          Use Battery Combo In This Quote
        </button>
        ${renderExternalAction(upgradeScenario.kit.storeUrl, 'View Battery Combo →', 'btn btn-outline')}
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
  if (!actionsEl) return;

  actionsEl.innerHTML = `
    <div class="result-actions">
      ${renderExternalAction(primaryScenario.kit.storeUrl, `View ${primaryScenario.kit.brand || 'Retailer'} Store →`, 'btn btn-primary')}
      <button class="btn btn-outline" id="btn-recalc-results">
        Refresh This Quote
      </button>
    </div>
  `;

  document.getElementById('btn-recalc-results')?.addEventListener('click', () => {
    resetResultsForRecalculation();
    calculateResults();
  });
}

function renderMonthlyChart(adjusted, solarData) {
  const ctx = document.getElementById('chart-monthly');
  if (!ctx) return;

  const labels = adjusted.months.map((month) => month.monthName);
  const data = adjusted.months.map((month) => month.adjustedKwh);

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

function estimateEnergyValue(annualKwh, kit, annualUsageKwh) {
  const electricityRate = config.electricityPrice / 100;
  const exportRate = (config.exportTariff ?? 0) / 100;
  const directSelfUseRatio = clamp(config.solarSelfUseRatio ?? 0.42, 0, 1);
  const householdDemandKwh = Math.max(0, annualUsageKwh || 0);
  const maxDirectSelfUseKwh = annualKwh * directSelfUseRatio;
  const directSelfUseKwh = Math.min(householdDemandKwh, maxDirectSelfUseKwh);

  let shiftedKwh = 0;
  let batteryLossKwh = 0;
  let rawShiftedKwh = 0;
  let exportKwh = annualKwh - directSelfUseKwh;

  if (kit.hasBattery) {
    const referenceBatteryWh = config.referenceBatteryCapacityWh ?? 2000;
    const batterySizeFactor = clamp((kit.batteryCapacityWh || referenceBatteryWh) / referenceBatteryWh, 0.65, 1.2);
    const rawShiftRatio = clamp((config.batteryShiftableShare ?? 0.38) * batterySizeFactor, 0, 1 - directSelfUseRatio);
    const roundTripEfficiency = config.batteryRoundTripEfficiency ?? 0.9;
    const remainingDemandKwh = Math.max(0, householdDemandKwh - directSelfUseKwh);
    const maxRawShiftedKwh = annualKwh * rawShiftRatio;
    const maxDeliveredShiftedKwh = maxRawShiftedKwh * roundTripEfficiency;

    shiftedKwh = Math.min(remainingDemandKwh, maxDeliveredShiftedKwh);
    rawShiftedKwh = roundTripEfficiency > 0
      ? Math.min(maxRawShiftedKwh, shiftedKwh / roundTripEfficiency)
      : 0;
    exportKwh = Math.max(0, annualKwh - directSelfUseKwh - rawShiftedKwh);
    batteryLossKwh = Math.max(0, rawShiftedKwh - shiftedKwh);
  }

  const selfUsedKwh = directSelfUseKwh + shiftedKwh;
  const billSavings = selfUsedKwh * electricityRate;
  const exportIncome = exportKwh * exportRate;
  const annualValue = billSavings + exportIncome;

  return {
    annualValue: roundCurrency(annualValue),
    billSavings: roundCurrency(billSavings),
    exportIncome: roundCurrency(exportIncome),
    selfUsedKwh: round1(selfUsedKwh),
    exportKwh: round1(exportKwh),
    shiftedKwh: round1(shiftedKwh),
    batteryLossKwh: round1(batteryLossKwh),
    selfUseRatio: annualKwh > 0 ? selfUsedKwh / annualKwh : 0,
    effectiveValuePerKwh: annualKwh > 0 ? annualValue / annualKwh : 0,
  };
}

function initUsageControls() {
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
    updateUsageAssumptionUi();
    resetResultsForRecalculation();
    calculateResults();
  });

  document.getElementById('annual-usage-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyAnnualUsageInput();
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
    updateUsageAssumptionUi();
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
  updateUsageAssumptionUi();
  resetResultsForRecalculation();
  calculateResults();
}

function updateUsageAssumptionUi() {
  const annualUsageInput = getAnnualUsageInput();
  const resolvedAnnualUsage = getResolvedAnnualUsageKwh();
  const usingDefaultAnnualUsage = isUsingDefaultAnnualUsage();

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
    helper.textContent = getAnnualUsageHelperText(usingDefaultAnnualUsage, resolvedAnnualUsage);
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

function getAnnualUsageHelperText(usingDefaultAnnualUsage, annualUsageKwh) {
  return usingDefaultAnnualUsage
    ? `Leave this blank to keep the UK typical household default of ${formatWholeNumber(DEFAULT_ANNUAL_USAGE_KWH)} kWh/year. Higher home use usually means more of the solar stays valuable on-site.`
    : `The quote is currently using ${formatWholeNumber(annualUsageKwh)} kWh/year to split generation between home use and spill. Clear the field or use the UK average button if you do not know your number yet.`;
}

function getBatteryUpgradeKit(selectedKit) {
  if (!selectedKit || selectedKit.hasBattery) return null;

  return kitsData.find((kit) => (
    kit.hasBattery
    && kit.brand === selectedKit.brand
    && kit.wattage === selectedKit.wattage
  )) || null;
}

function resolveSelectedKit(selectedKit) {
  if (!selectedKit?.id) return null;
  return kitsData.find((kit) => kit.id === selectedKit.id) || null;
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
  document.getElementById('results-content')?.classList.add('hidden');
  document.getElementById('results-loading')?.classList.remove('hidden');
}

function showError(message) {
  destroyCharts();
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

function round1(value) {
  return Math.round(value * 10) / 10;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function formatWholeNumber(value) {
  return Math.round(value || 0).toLocaleString('en-GB');
}

function hasExportPayment() {
  return (config.exportTariff ?? 0) > 0;
}

function renderExternalAction(url, label, className) {
  const safeUrl = sanitizeExternalUrl(url, { allowedHosts: ALLOWED_RETAILER_HOSTS });
  if (!safeUrl) {
    return `<button class="${className}" type="button" disabled>${escapeHtml(label)}</button>`;
  }

  return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="${className}">${escapeHtml(label)}</a>`;
}

export function cleanup() {
  calculationRequestId += 1;
  destroyCharts();
}
