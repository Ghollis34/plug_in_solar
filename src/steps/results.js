import Chart from 'chart.js/auto';
import { getState, setState } from '../utils/state.js';
import { fetchSolarData, adjustForShadows } from '../utils/pvgis.js';
import { calculateROI, formatCurrency, formatPayback } from '../utils/roi.js';
import config from '../data/config.json';

let charts = [];

export function render() {
  return `
    <div class="step-page scrollable">
      <div class="step-header">
        <h2 class="step-title">💰 Your Solar Results</h2>
        <p class="step-subtitle">Here's what plug-in solar could do for you</p>
      </div>

      <div class="step-body">
        <div id="results-loading" class="loading-overlay">
          <div class="loading-spinner"></div>
          <p>Calculating your solar potential...</p>
          <p style="font-size: 0.8rem; color: var(--text-muted);">Fetching irradiance data from EU PVGIS database</p>
        </div>

        <div id="results-content" class="hidden">
          <!-- Recommendation -->
          <div class="recommendation-card" id="recommendation-card"></div>

          <!-- Key Metrics -->
          <div class="results-grid" id="results-grid"></div>

          <!-- Charts -->
          <div class="chart-container">
            <h4 class="chart-title">Monthly Energy Generation (kWh)</h4>
            <canvas id="chart-monthly" class="chart-canvas"></canvas>
          </div>

          <div class="chart-container">
            <h4 class="chart-title">Cumulative Savings Over Time (£)</h4>
            <canvas id="chart-savings" class="chart-canvas"></canvas>
          </div>

          <!-- Pricing Source -->
          <div class="disclaimer mt-md">
            <span class="disclaimer-icon">ℹ️</span>
            <span id="price-disclaimer">
              Based on ${config.electricityPriceSource}: ${config.electricityPrice}${config.electricityPriceUnit}. 
              Solar irradiance data from EU PVGIS. Shadow estimates are approximate.
            </span>
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

  // Run calculations
  calculateResults();
}

async function calculateResults() {
  const location = getState('location');
  const selectedKit = getState('selectedKit');
  const sunAnalysis = getState('sunAnalysis');
  const spaces = getState('spaces') || [];
  const selectedSpaceId = getState('selectedSpaceId');

  if (!location || !selectedKit) {
    showError('Missing location or kit selection.');
    return;
  }

  try {
    const rankedSpaces = sunAnalysis?.scores || [];
    const selectedSpace = rankedSpaces.find((space) => space.id === selectedSpaceId)
      || rankedSpaces[0]
      || spaces.find((space) => space.id === selectedSpaceId)
      || spaces[0]
      || {};
    const recommendedSpace = rankedSpaces[0] || selectedSpace;
    const orientation = selectedSpace.orientation || 180;
    const pvgisAzimuth = orientation - 180;
    const tilt = selectedSpace.tilt || 35;

    const solarData = await fetchSolarData(location.lat, location.lng, tilt, pvgisAzimuth);
    const baselineFactor = clamp(selectedSpace.shadowFactor ?? ((selectedSpace.avgDailyHours || 6) / 12), 0, 1);
    const conservativeFactor = clamp(selectedSpace.conservativeFactor ?? (baselineFactor - 0.14), 0, 1);
    const optimisticFactor = clamp(selectedSpace.optimisticFactor ?? (baselineFactor + 0.14), 0, 1);

    const adjusted = adjustForShadows(solarData, baselineFactor, selectedKit.wattage);
    const conservativeAdjusted = adjustForShadows(solarData, conservativeFactor, selectedKit.wattage);
    const optimisticAdjusted = adjustForShadows(solarData, optimisticFactor, selectedKit.wattage);

    const roi = calculateROI({
      kitCost: selectedKit.price,
      annualKwh: adjusted.annualKwh,
      warrantyYears: selectedKit.warrantyYears,
    });

    setState({
      results: {
        annualKwh: adjusted.annualKwh,
        conservativeKwh: conservativeAdjusted.annualKwh,
        optimisticKwh: optimisticAdjusted.annualKwh,
        annualSavings: roi.annualSavingsYear1,
        paybackYears: roi.paybackYears,
      },
    });

    displayResults(roi, adjusted, conservativeAdjusted, optimisticAdjusted, selectedSpace, recommendedSpace, selectedKit, solarData);

  } catch (error) {
    console.error('Results calculation failed:', error);
    showError('Failed to calculate results. Please try again.');
  }
}

function displayResults(roi, adjusted, conservativeAdjusted, optimisticAdjusted, selectedSpace, recommendedSpace, kit, solarData) {
  document.getElementById('results-loading')?.classList.add('hidden');
  document.getElementById('results-content')?.classList.remove('hidden');

  const compassDir = getCompassDirection(selectedSpace.orientation || 180);
  const warningsHtml = (selectedSpace.warnings || [])
    .map(warning => `<div style="font-size: 0.82rem; color: var(--text-secondary);">${warning}</div>`)
    .join('');
  const selectionNote = selectedSpace.id && recommendedSpace.id && selectedSpace.id !== recommendedSpace.id
    ? `<div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 8px;">ROI is using your chosen spot, <strong>${selectedSpace.name}</strong>. The model still ranks <strong>${recommendedSpace.name}</strong> as the strongest sun location.</div>`
    : '';

  document.getElementById('recommendation-card').innerHTML = `
    <h3>⭐ Our Recommendation</h3>
    <p class="recommendation-text">
      Put your <strong>${kit.name}</strong> on your 
      <strong>${selectedSpace.name || 'selected spot'}</strong> 
      facing <strong>${compassDir}</strong> at <strong>${selectedSpace.tilt || 35}°</strong> tilt.
      ${selectedSpace.avgDailyHours ? `This spot gets an average of <strong>${selectedSpace.avgDailyHours} hours</strong> of direct sunlight per day.` : ''}
      The modelled first-year output is <strong>${roi.annualKwhYear1} kWh</strong>, with a more honest expected range of
      <strong>${conservativeAdjusted.annualKwh}-${optimisticAdjusted.annualKwh} kWh/year</strong>.
    </p>
    <div class="badge-row" style="margin: 14px 0 10px;">
      <span class="info-badge">Confidence: ${capitalise(selectedSpace.confidence || 'medium')}</span>
      <span class="info-badge">Shadow factor: ${Math.round((selectedSpace.shadowFactor || adjusted.shadowFactor) * 100)}%</span>
    </div>
    ${warningsHtml}
    ${selectionNote}
  `;

  document.getElementById('results-grid').innerHTML = `
    <div class="card result-card">
      <div class="result-icon">⚡</div>
      <div class="result-value accent" id="counter-kwh">${conservativeAdjusted.annualKwh}-${optimisticAdjusted.annualKwh}</div>
      <div class="result-label">kWh / year</div>
      <div class="result-sublabel">Conservative to optimistic</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">💰</div>
      <div class="result-value accent" id="counter-savings">${formatCurrency(roi.annualSavingsYear1)}</div>
      <div class="result-label">Annual Savings</div>
      <div class="result-sublabel">Year 1</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">⏱️</div>
      <div class="result-value success">${formatPayback(roi.paybackYears)}</div>
      <div class="result-label">Payback Period</div>
      <div class="result-sublabel">Kit cost: ${formatCurrency(roi.kitCost)}</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">📈</div>
      <div class="result-value accent">${formatCurrency(roi.netReturn25yr)}</div>
      <div class="result-label">25-Year Net Return</div>
      <div class="result-sublabel">${roi.roiPercent}% ROI</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">🌍</div>
      <div class="result-value success">${roi.totalCo2_25yr} kg</div>
      <div class="result-label">CO₂ Saved</div>
      <div class="result-sublabel">Over 25 years</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">☀️</div>
      <div class="result-value accent">${selectedSpace.avgDailyHours || '~6'}h</div>
      <div class="result-label">Daily Sun Hours</div>
      <div class="result-sublabel">Average at chosen spot</div>
    </div>
    <div class="card result-card">
      <div class="result-icon">🧭</div>
      <div class="result-value accent">${capitalise(selectedSpace.confidence || 'medium')}</div>
      <div class="result-label">Confidence</div>
      <div class="result-sublabel">${selectedSpace.relativeDirectionLabel || 'Position estimated'}</div>
    </div>
  `;

  animateCounters();
  renderMonthlyChart(adjusted, solarData);
  renderSavingsChart(roi);

  document.getElementById('price-disclaimer').textContent = `
    Based on ${config.electricityPriceSource}: ${config.electricityPrice}${config.electricityPriceUnit}. Solar irradiance data from EU PVGIS.
    Shadow results use a simplified obstacle model and are shown as a range because trees, fences, and assumed building footprints remain approximate.
  `;
}

function renderMonthlyChart(adjusted, solarData) {
  const ctx = document.getElementById('chart-monthly');
  if (!ctx) return;

  const labels = adjusted.months.map(m => m.monthName);
  const data = adjusted.months.map(m => m.adjustedKwh);

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'kWh Generated',
        data,
        backgroundColor: data.map(v => {
          const intensity = v / Math.max(...data);
          return `rgba(245, 158, 11, ${0.3 + intensity * 0.7})`;
        }),
        borderColor: 'rgba(245, 158, 11, 1)',
        borderWidth: 1,
        borderRadius: 6,
      }]
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
            label: (ctx) => `${ctx.parsed.y} kWh`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748B', font: { family: 'Inter' } },
          grid: { display: false },
        },
        y: {
          ticks: { color: '#64748B', font: { family: 'Inter' }, callback: v => `${v} kWh` },
          grid: { color: 'rgba(148,163,184,0.08)' },
        }
      }
    }
  });

  charts.push(chart);
}

function renderSavingsChart(roi) {
  const ctx = document.getElementById('chart-savings');
  if (!ctx) return;

  const labels = roi.yearlyData.map(y => `Year ${y.year}`);
  const cumSavings = roi.yearlyData.map(y => y.cumulativeSavings);
  const kitCostLine = roi.yearlyData.map(() => roi.kitCost);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Cumulative Savings',
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
          label: 'Kit Cost',
          data: kitCostLine,
          borderColor: 'rgba(239, 68, 68, 0.5)',
          borderWidth: 2,
          borderDash: [8, 4],
          pointRadius: 0,
          fill: false,
        }
      ]
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
            label: (ctx) => `${ctx.dataset.label}: £${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748B', font: { family: 'Inter' }, maxTicksLimit: 10 },
          grid: { display: false },
        },
        y: {
          ticks: { color: '#64748B', font: { family: 'Inter' }, callback: v => `£${v}` },
          grid: { color: 'rgba(148,163,184,0.08)' },
        }
      }
    }
  });

  charts.push(chart);
}

function animateCounters() {
  document.querySelectorAll('.result-value').forEach(el => {
    el.style.animation = 'countUp 0.6s ease forwards';
  });
}

function showError(message) {
  document.getElementById('results-loading').innerHTML = `
    <div style="color: var(--danger); font-size: 1.2rem; margin-bottom: 8px;">⚠️</div>
    <p>${message}</p>
    <button class="btn btn-secondary mt-md" onclick="window.dispatchEvent(new CustomEvent('wizard:back'))">
      ← Go Back
    </button>
  `;
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

export function cleanup() {
  charts.forEach(c => c.destroy());
  charts = [];
}
