import config from '../data/config.json';
import kitsData from '../data/kits.json';
import { fetchSolarData } from '../utils/pvgis.js';
import {
  findPricedKitById,
  getKitPriceDetailLabel,
  getKitPriceStatusLabel,
  getPricedKits,
  loadLivePricing,
} from '../utils/kit-pricing.js';
import { buildScenario, assumesNoSolarSpill, usesFullSolarCapture } from '../utils/quote-model.js';
import { formatCurrency, formatPayback } from '../utils/roi.js';
import { escapeHtml, safeDataId } from '../utils/security.js';
import { getState, setState } from '../utils/state.js';
import {
  DEFAULT_ANNUAL_USAGE_SOURCE,
  getLocationState,
  getResolvedAnnualUsageKwh,
  getResolvedElectricityPricing,
  getSelectedOrRecommendedSpace,
  isUsingCustomElectricityPrice,
  isUsingDefaultAnnualUsage,
} from '../utils/site-state.js';

let activeFilters = { wattage: 'all', brand: 'all' };
let activeSort = 'output';
let comparisonRequestId = 0;
let comparisonState = {
  status: 'idle',
  scenarios: [],
  context: null,
  error: '',
};
let pricingState = {
  status: 'idle',
  feed: null,
  kits: getPricedKits(),
};

export function render() {
  activeFilters = { wattage: 'all', brand: 'all' };
  activeSort = 'output';
  comparisonState = {
    status: 'idle',
    scenarios: [],
    context: null,
    error: '',
  };

  const selectedKit = resolveSelectedKitForUi();
  return `
    <div class="step-page scrollable">
      <div class="step-header">
        <div class="section-kicker">Step 5 · Kits</div>
        <h2 class="step-title">Choose Your Kit</h2>
        <p class="step-subtitle">Compare the live output, value, and payback case for each package before you choose which quote to open in detail.</p>
      </div>

      <div class="step-body">
        <div class="kit-page-lead">
          <div>
            <div class="map-panel-kicker">Live comparison</div>
            <h3 class="map-panel-title">Rank plug-in solar kits against your saved location and panel spot.</h3>
          </div>
          <div class="map-panel-pill" id="kit-sort-pill">${escapeHtml(getActiveSortLabel())}</div>
        </div>

        <div class="kit-package-summary">
          <div class="kit-package-card">
            <div class="kit-package-eyebrow">Solar Only</div>
            <div class="kit-package-title">Lower upfront cost</div>
            <div class="kit-package-copy">
              Best if you want the cheapest route into plug-in solar first, with midday export still treated as lower-value or unpaid in the quote.
            </div>
          </div>
          <div class="kit-package-card battery">
            <div class="kit-package-eyebrow">Battery Combo</div>
            <div class="kit-package-title">More control later in the day</div>
            <div class="kit-package-copy">
              Adds storage to capture more midday solar and unlock smart-tariff charging value on top of the generation gain.
            </div>
          </div>
        </div>

        <div class="card-flat kit-comparison-card" id="kit-comparison-summary">
          ${renderComparisonSummary()}
        </div>

        <div class="kit-toolbar">
          <div class="kit-filters" id="kit-filters">
            <button class="filter-chip active" data-filter="wattage" data-value="all">All Sizes</button>
            <button class="filter-chip" data-filter="wattage" data-value="small">≤400W</button>
            <button class="filter-chip" data-filter="wattage" data-value="large">700W+</button>
            <span class="kit-toolbar-divider">|</span>
            <button class="filter-chip active" data-filter="brand" data-value="all">All Brands</button>
            ${[...new Set(kitsData.map((kit) => kit.brand))].map((brand) => `
              <button class="filter-chip" data-filter="brand" data-value="${safeDataId(brand)}">${escapeHtml(brand)}</button>
            `).join('')}
          </div>

          <div class="kit-sort-controls" id="kit-sort-controls">
            ${renderSortButton('Best Output', 'output')}
            ${renderSortButton('Fastest Payback', 'payback')}
            ${renderSortButton('Highest Return', 'return')}
            ${renderSortButton('Lowest Price', 'price')}
          </div>
        </div>

        <div class="analysis-note mb-md">
          Retailer links still move to the results page after you choose a setup, so you can inspect the full quote and any matched battery path before leaving the planner.
        </div>

        <div id="kits-grid">
          ${renderKitGrid(selectedKit?.id)}
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-kits">← Back</button>
        <div class="kit-step-status" id="kit-step-status">${getKitStepStatusText(selectedKit)}</div>
        <button class="btn btn-primary" id="btn-next-kits" ${selectedKit ? '' : 'disabled'}>
          Continue to Results →
        </button>
      </div>
    </div>
  `;
}

export function init() {
  initFilters();
  initSortControls();
  initKitSelection();
  updateNextButton();
  loadKitPriceFeed(getSelectedOrRecommendedSpace()?.type || null);
  loadKitComparisons();

  document.getElementById('btn-back-kits')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-kits')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

export function cleanup() {
  comparisonRequestId += 1;
}

function renderSortButton(label, value) {
  return `
    <button class="filter-chip ${activeSort === value ? 'active' : ''}" data-sort="${safeDataId(value)}">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderComparisonSummary() {
  if (comparisonState.status === 'loading') {
    return `
      <div class="kit-comparison-header">
        <div>
          <div class="results-kicker">Scoring kits</div>
          <h3 class="results-usage-title">Building the comparison table</h3>
        </div>
        <div class="map-panel-pill">Loading live model</div>
      </div>
      <div class="analysis-note">Fetching PVGIS irradiance data, loading the retailer price feed, and applying the same ROI model used on the results page.</div>
    `;
  }

  if (comparisonState.status === 'error') {
    return `
      <div class="kit-comparison-header">
        <div>
          <div class="results-kicker">Live comparison unavailable</div>
          <h3 class="results-usage-title">Static catalogue fallback</h3>
        </div>
        <div class="map-panel-pill">Retry on results page</div>
      </div>
      <div class="analysis-note">${escapeHtml(comparisonState.error || 'We could not load the live kit comparison just now, but you can still choose a package and price it on the next step.')}</div>
    `;
  }

  if (comparisonState.status !== 'ready' || !comparisonState.context) {
    return `
      <div class="kit-comparison-header">
        <div>
          <div class="results-kicker">Waiting for inputs</div>
          <h3 class="results-usage-title">Choose a location and panel spot first</h3>
        </div>
        <div class="map-panel-pill">Comparison paused</div>
      </div>
      <div class="analysis-note">The live ranking will appear here once the planner has a saved location and at least one suitable panel space.</div>
    `;
  }

  const { pricing, annualUsageKwh, usingDefaultAnnualUsage, usingCustomElectricityPrice, selectedSpace } = comparisonState.context;
  const bestOutputScenario = getSortedScenarios('output')[0];
  const fastestPaybackScenario = getSortedScenarios('payback')[0];
  const usageCopy = usingDefaultAnnualUsage
    ? `${formatWholeNumber(annualUsageKwh)} kWh/year from ${DEFAULT_ANNUAL_USAGE_SOURCE}`
    : `${formatWholeNumber(annualUsageKwh)} kWh/year from your saved usage`;
  const tariffCopy = usingCustomElectricityPrice
    ? `${formatRatePence(pricing.unitRatePence)} p/kWh custom import rate`
    : `${formatRatePence(pricing.unitRatePence)} p/kWh ${pricing.region ? `${pricing.region} regional rate` : 'GB average fallback'}`;

  return `
    <div class="kit-comparison-header">
      <div>
        <div class="results-kicker">Comparison assumptions</div>
        <h3 class="results-usage-title">Ranked for ${escapeHtml(selectedSpace?.name || 'your saved panel spot')}</h3>
      </div>
      <div class="map-panel-pill">${escapeHtml(getActiveSortLabel())}</div>
    </div>
    <p class="kit-comparison-copy">
      This page is ranking kits using ${escapeHtml(usageCopy)} and ${escapeHtml(tariffCopy)} on
      <strong>${escapeHtml(selectedSpace?.name || 'your selected space')}</strong> facing
      <strong>${escapeHtml(getCompassDirection(selectedSpace?.orientation || 180))}</strong> at
      <strong>${selectedSpace?.tilt || 35}°</strong> tilt. Headline numbers on each card show the upper-end modelled outcome, with the wider range kept underneath. Payback assumes saved electricity value rises by about ${Math.round((config.annualValueGrowthRate ?? 0) * 100)}% per year.
    </p>
    <div class="analysis-note" style="margin-bottom: 14px;">Kit pricing prefers live official retailer pricing where we have a mapped source, and falls back to the in-app catalogue where we do not.</div>
    <div class="kit-comparison-stats">
      <div class="kit-comparison-stat">
        <div class="kit-comparison-stat-label">Top output right now</div>
        <div class="kit-comparison-stat-value">${bestOutputScenario ? formatWholeNumber(bestOutputScenario.optimisticAdjusted.annualKwh) : '0'} kWh</div>
        <div class="kit-comparison-stat-note">${bestOutputScenario ? escapeHtml(bestOutputScenario.kit.name) : 'Unavailable'}</div>
      </div>
      <div class="kit-comparison-stat">
        <div class="kit-comparison-stat-label">Fastest payback right now</div>
        <div class="kit-comparison-stat-value">${fastestPaybackScenario ? formatPayback(fastestPaybackScenario.optimisticRoi.paybackYears) : 'N/A'}</div>
        <div class="kit-comparison-stat-note">${fastestPaybackScenario ? escapeHtml(fastestPaybackScenario.kit.name) : 'Unavailable'}</div>
      </div>
      <div class="kit-comparison-stat">
        <div class="kit-comparison-stat-label">Model assumption</div>
        <div class="kit-comparison-stat-value">${assumesNoSolarSpill() ? 'Battery capture active' : 'Spill modelled'}</div>
        <div class="kit-comparison-stat-note">${assumesNoSolarSpill() ? 'Solar-only kits still allow a small amount of unpaid spill, but the model assumes strong daytime home use. Battery kits capture that solar on-site and add smart-tariff value.' : 'Export/spill handling still affects the value model.'}</div>
      </div>
    </div>
  `;
}

function renderKitGrid(selectedId) {
  if (comparisonState.status === 'loading') {
    return `
      <div class="loading-overlay" style="min-height: 280px;">
        <div class="loading-spinner"></div>
        <p>Ranking kits for your home…</p>
      </div>
    `;
  }

  const items = getVisibleItems();
  if (items.length === 0) {
    return `
      <div class="loading-overlay" style="min-height: 220px;">
        <p>No kits match your filters. Try adjusting them.</p>
      </div>
    `;
  }

  return `
    <div class="kits-grid">
      ${items.map((item, index) => renderKitCard(item, selectedId, index)).join('')}
    </div>
  `;
}

function renderKitCard(item, selectedId, index) {
  const comparison = item?.kit ? item : null;
  const kit = comparison?.kit || item;
  const isSelected = kit.id === selectedId;
  const compatibility = getCompatibilityState(kit);

  const rangeOutput = comparison
    ? `${formatWholeNumber(comparison.conservativeAdjusted.annualKwh)} to ${formatWholeNumber(comparison.optimisticAdjusted.annualKwh)} kWh`
    : null;
  const rangeValue = comparison
    ? formatCurrencyRange(comparison.conservativeValueModel.annualValue, comparison.optimisticValueModel.annualValue)
    : null;
  const rangePayback = comparison
    ? formatPaybackRange(comparison.conservativeRoi.paybackYears, comparison.optimisticRoi.paybackYears)
    : null;
  const rangeReturn = comparison
    ? formatCurrencyRange(comparison.conservativeRoi.netReturn25yr, comparison.optimisticRoi.netReturn25yr)
    : null;
  const smartTariffValue = comparison?.optimisticValueModel.smartTariffSavings ?? 0;
  const fullCapture = usesFullSolarCapture(kit);
  const metricCopy = comparison
    ? fullCapture
      ? smartTariffValue > 0
        ? `${formatCurrency(smartTariffValue)} smart-tariff value with battery-led full capture in the upper-end model`
        : 'Battery path assumes full solar capture in the upper-end model'
      : comparison.kit.hasBattery
      ? smartTariffValue > 0
        ? `${formatCurrency(smartTariffValue)} smart-tariff value in the upper-end model`
        : `${Math.round(comparison.optimisticValueModel.shiftedKwh)} kWh/year shifted later with storage`
      : `${Math.round(comparison.optimisticValueModel.exportKwh)} kWh/year still spilling in the upper-end solar-only model after assuming strong daytime home use`
    : (kit.hasBattery ? 'Battery storage included in this package' : 'Solar-only starter package');
  const priceStatus = getKitPriceStatusLabel(kit.priceMeta);
  const priceDetail = getKitPriceDetailLabel(kit.priceMeta);

  return `
    <div class="card kit-card ${isSelected ? 'selected' : ''}" data-kit-id="${safeDataId(kit.id)}" id="kit-${safeDataId(kit.id)}">
      <div class="kit-rank-badge">#${index + 1} · ${escapeHtml(getActiveSortLabel())}</div>
      <div class="kit-select-badge">✓ Selected</div>
      <div class="kit-card-image">
        <span style="font-size: 3rem;">${kit.hasBattery ? '🔋' : '☀️'}</span>
      </div>
      <div class="kit-card-body">
        <div class="kit-card-topline">
          <div class="kit-brand">${escapeHtml(kit.brand)}</div>
          <span class="kit-package-pill ${kit.hasBattery ? 'battery' : 'solar'}">${kit.hasBattery ? 'Battery combo' : 'Solar only'}</span>
        </div>
        <h3 class="kit-name">${escapeHtml(kit.name)}</h3>
        <p class="kit-desc">${escapeHtml(kit.description)}</p>

        <div class="kit-specs">
          <span class="kit-spec-tag highlight">${kit.wattage}W</span>
          <span class="kit-spec-tag">${kit.panelCount} panel${kit.panelCount > 1 ? 's' : ''}</span>
          <span class="kit-spec-tag">${kit.weightKg}kg</span>
          <span class="kit-spec-tag">${kit.warrantyYears}yr warranty</span>
          ${kit.hasBattery ? `<span class="kit-spec-tag highlight">${(kit.batteryCapacityWh / 1000).toFixed(1)}kWh battery</span>` : ''}
          <span class="kit-spec-tag ${compatibility.className}">${escapeHtml(compatibility.label)}</span>
        </div>

        ${comparison ? `
          <div class="kit-card-metrics">
            ${renderMetricBlock(formatWholeNumber(comparison.optimisticAdjusted.annualKwh), 'Best-case output', rangeOutput)}
            ${renderMetricBlock(formatCurrency(comparison.optimisticValueModel.annualValue), 'First-year value', rangeValue)}
            ${renderMetricBlock(formatPayback(comparison.optimisticRoi.paybackYears), 'Fastest payback', rangePayback)}
            ${renderMetricBlock(formatCurrency(comparison.optimisticRoi.netReturn25yr), '25-year return', rangeReturn)}
          </div>
          <div class="kit-card-analysis-note">${escapeHtml(metricCopy)}</div>
        ` : `
          <div class="analysis-note" style="margin-bottom: 14px;">Live output and ROI details are unavailable until the planner finishes loading the comparison model.</div>
        `}

        <div style="margin-bottom: 12px;">
          ${kit.features.map((feature) => `
            <span style="font-size: 0.75rem; color: var(--text-muted); display: inline-block; margin-right: 10px;">• ${escapeHtml(feature)}</span>
          `).join('')}
        </div>

        <div class="kit-footer">
          <div>
            <div class="kit-price">£${kit.price}</div>
            <div class="kit-price-note">${comparison ? `${comparison.optimisticRoi.roiPercent}% 25-year ROI in the upper-end model` : (kit.hasBattery ? 'Solar + storage package' : 'Solar generation only')}</div>
            <div class="kit-price-source" title="${escapeHtml(priceDetail)}">${escapeHtml(priceStatus)}</div>
          </div>
          <div class="kit-select-hint">${isSelected ? 'Selected for quote' : 'Click to select'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderMetricBlock(value, label, note) {
  return `
    <div class="kit-card-metric">
      <div class="kit-card-metric-value">${escapeHtml(value)}</div>
      <div class="kit-card-metric-label">${escapeHtml(label)}</div>
      <div class="kit-card-metric-note">${escapeHtml(note || 'Range unavailable')}</div>
    </div>
  `;
}

function loadKitComparisons() {
  const requestId = ++comparisonRequestId;
  const location = getLocationState();
  const selectedSpace = getSelectedOrRecommendedSpace();
  const annualUsageKwh = getResolvedAnnualUsageKwh();
  const pricing = getResolvedElectricityPricing();
  const spaceType = selectedSpace?.type || null;

  loadKitPriceFeed(spaceType);

  if (!location || !selectedSpace) {
    comparisonState = {
      status: 'error',
      scenarios: [],
      context: null,
      error: 'Save a location and at least one panel space to unlock the live kit ranking.',
    };
    refreshComparisonUi();
    return;
  }

  comparisonState = {
    status: 'loading',
    scenarios: [],
    context: null,
    error: '',
  };
  refreshComparisonUi();

  const orientation = selectedSpace.orientation || 180;
  const tilt = selectedSpace.tilt || 35;
  const pvgisAzimuth = orientation - 180;
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

  Promise.all([
    fetchSolarData(location.lat, location.lng, tilt, pvgisAzimuth),
    loadKitPriceFeed(spaceType),
  ])
    .then(([solarData, livePricing]) => {
      if (requestId !== comparisonRequestId) return;
      const pricedKits = getPricedKits(livePricing, { spaceType });

      const scenarios = pricedKits.map((kit) => buildScenario(kit, solarData, {
        baselineFactor,
        conservativeFactor,
        optimisticFactor,
        annualUsageKwh,
        pricing,
      }));

      comparisonState = {
        status: 'ready',
        scenarios,
        context: {
          annualUsageKwh,
          pricing,
          selectedSpace,
          usingDefaultAnnualUsage: isUsingDefaultAnnualUsage(),
          usingCustomElectricityPrice: isUsingCustomElectricityPrice(),
        },
        error: '',
      };
      refreshComparisonUi();
    })
    .catch((error) => {
      if (requestId !== comparisonRequestId) return;
      console.error('Kit comparison failed:', error);
      comparisonState = {
        status: 'error',
        scenarios: [],
        context: null,
        error: 'We could not load the live PVGIS comparison for this step. You can still choose a kit and open the results page for a direct quote.',
      };
      refreshComparisonUi();
    });
}

function refreshComparisonUi() {
  const summaryEl = document.getElementById('kit-comparison-summary');
  if (summaryEl) {
    summaryEl.innerHTML = renderComparisonSummary();
  }

  const sortPill = document.getElementById('kit-sort-pill');
  if (sortPill) {
    sortPill.textContent = getActiveSortLabel();
  }

  const gridEl = document.getElementById('kits-grid');
  if (gridEl) {
    gridEl.innerHTML = renderKitGrid(getState('selectedKit')?.id);
  }

  initKitSelection();
  updateNextButton();
}

function initFilters() {
  document.querySelectorAll('.filter-chip[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const filterType = chip.dataset.filter;
      const value = chip.dataset.value;

      document.querySelectorAll(`.filter-chip[data-filter="${filterType}"]`).forEach((entry) => {
        entry.classList.remove('active');
      });
      chip.classList.add('active');

      activeFilters[filterType] = value;
      refreshComparisonUi();
    });
  });
}

function initSortControls() {
  document.querySelectorAll('.filter-chip[data-sort]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const nextSort = chip.dataset.sort;
      if (!nextSort) return;

      activeSort = nextSort;
      document.querySelectorAll('.filter-chip[data-sort]').forEach((entry) => {
        entry.classList.toggle('active', entry.dataset.sort === nextSort);
      });
      refreshComparisonUi();
    });
  });
}

function getVisibleItems() {
  const sourceItems = comparisonState.status === 'ready'
    ? sortScenarios(comparisonState.scenarios)
    : [...pricingState.kits];

  return sourceItems.filter((item) => {
    const kit = item?.kit || item;

    if (activeFilters.wattage === 'small' && kit.wattage > 400) {
      return false;
    }

    if (activeFilters.wattage === 'large' && kit.wattage < 700) {
      return false;
    }

    if (activeFilters.brand !== 'all' && kit.brand !== activeFilters.brand) {
      return false;
    }

    return true;
  });
}

function getSortedScenarios(sortMode = activeSort) {
  return sortScenarios([...comparisonState.scenarios], sortMode);
}

function sortScenarios(scenarios, sortMode = activeSort) {
  return [...scenarios].sort((scenarioA, scenarioB) => {
    const compatibilityDelta = Number(isCompatibleWithSelectedSpace(scenarioB.kit)) - Number(isCompatibleWithSelectedSpace(scenarioA.kit));
    if (compatibilityDelta !== 0) {
      return compatibilityDelta;
    }

    if (sortMode === 'payback') {
      const paybackA = Number.isFinite(scenarioA.optimisticRoi.paybackYears) ? scenarioA.optimisticRoi.paybackYears : Number.POSITIVE_INFINITY;
      const paybackB = Number.isFinite(scenarioB.optimisticRoi.paybackYears) ? scenarioB.optimisticRoi.paybackYears : Number.POSITIVE_INFINITY;
      if (paybackA !== paybackB) {
        return paybackA - paybackB;
      }
    }

    if (sortMode === 'return') {
      const returnDelta = scenarioB.optimisticRoi.netReturn25yr - scenarioA.optimisticRoi.netReturn25yr;
      if (returnDelta !== 0) {
        return returnDelta;
      }
    }

    if (sortMode === 'price') {
      const priceDelta = scenarioA.kit.price - scenarioB.kit.price;
      if (priceDelta !== 0) {
        return priceDelta;
      }
    }

    const outputDelta = scenarioB.optimisticAdjusted.annualKwh - scenarioA.optimisticAdjusted.annualKwh;
    if (outputDelta !== 0) {
      return outputDelta;
    }

    const valueDelta = scenarioB.optimisticValueModel.annualValue - scenarioA.optimisticValueModel.annualValue;
    if (valueDelta !== 0) {
      return valueDelta;
    }

    return scenarioA.kit.price - scenarioB.kit.price;
  });
}

function initKitSelection() {
  document.querySelectorAll('.kit-card').forEach((card) => {
    card.addEventListener('click', () => {
      const kitId = card.dataset.kitId;
      const kit = findPricedKitById(kitId, pricingState.feed, { spaceType: getSelectedSpaceType() });
      if (!kit) return;

      const currentKit = getState('selectedKit');
      let nextSelectedId = null;
      if (currentKit?.id === kitId) {
        setState({ selectedKit: null });
      } else {
        setState({ selectedKit: kit });
        nextSelectedId = kit.id;
      }

      syncSelectedKitUi(nextSelectedId);
      updateNextButton();
    });
  });
}

function loadKitPriceFeed(spaceType = null) {
  pricingState = {
    ...pricingState,
    status: 'loading',
  };

  return loadLivePricing()
    .then((feed) => {
      pricingState = {
        status: 'ready',
        feed,
        kits: getPricedKits(feed, { spaceType }),
      };
      refreshComparisonUi();
      return feed;
    })
    .catch(() => {
      pricingState = {
        status: 'error',
        feed: null,
        kits: getPricedKits(null, { spaceType }),
      };
      refreshComparisonUi();
      return null;
    });
}

function getSelectedSpaceType() {
  return comparisonState.context?.selectedSpace?.type || getSelectedOrRecommendedSpace()?.type || null;
}

function updateNextButton() {
  const selectedKit = resolveSelectedKitForUi();
  const nextButton = document.getElementById('btn-next-kits');
  if (nextButton) {
    nextButton.disabled = !selectedKit;
  }

  const statusEl = document.getElementById('kit-step-status');
  if (statusEl) {
    statusEl.textContent = getKitStepStatusText(selectedKit);
  }
}

function syncSelectedKitUi(selectedId = null) {
  document.querySelectorAll('.kit-card').forEach((entry) => {
    const isSelected = entry.dataset.kitId === selectedId;
    entry.classList.toggle('selected', isSelected);

    const hintEl = entry.querySelector('.kit-select-hint');
    if (hintEl) {
      hintEl.textContent = isSelected ? 'Selected for quote' : 'Click to select';
    }
  });
}

function getKitStepStatusText(selectedKit) {
  return selectedKit?.name
    ? `${selectedKit.name} selected. Continue to open the full quote.`
    : 'Select a kit to continue to the full quote.';
}

function resolveSelectedKitForUi() {
  return findPricedKitById(getState('selectedKit'), pricingState.feed, { spaceType: getSelectedSpaceType() });
}

function getCompatibilityState(kit) {
  const compatibility = isCompatibleWithSelectedSpace(kit);

  if (compatibility === true) {
    return {
      className: 'kit-spec-tag-compatible',
      label: `Fits ${formatSpaceTypeLabel(comparisonState.context?.selectedSpace?.type)}`,
    };
  }

  const selectedSpaceType = comparisonState.context?.selectedSpace?.type;
  if (selectedSpaceType) {
    return {
      className: 'kit-spec-tag-warning',
      label: `Check ${formatSpaceTypeLabel(selectedSpaceType)} fit`,
    };
  }

  return {
    className: '',
    label: 'Mounting fit to confirm',
  };
}

function isCompatibleWithSelectedSpace(kit) {
  const selectedSpaceType = comparisonState.context?.selectedSpace?.type;
  return selectedSpaceType ? kit.mountingTypes.includes(selectedSpaceType) : null;
}

function formatSpaceTypeLabel(spaceType) {
  if (!spaceType) return 'saved space';

  return String(spaceType)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getActiveSortLabel() {
  return ({
    output: 'Best Output',
    payback: 'Fastest Payback',
    return: 'Highest Return',
    price: 'Lowest Price',
  })[activeSort] || 'Best Output';
}

function getCompassDirection(deg) {
  const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
