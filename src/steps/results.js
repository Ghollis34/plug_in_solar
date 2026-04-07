import Chart from 'chart.js/auto';
import { getState } from '../utils/state.js';
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

  if (!location || !selectedKit) {
    showError('Missing location or kit selection.');
    return;
  }

  try {
    // Get best space orientation/tilt
    const bestSpace = sunAnalysis?.scores?.[0] || spaces[0] || {};
    const orientation = bestSpace.orientation || 180;
    // Convert orientation (0=N, 180=S) to PVGIS azimuth (-180 to 180, 0=south)
    const pvgisAzimuth = orientation <= 180 ? orientation - 180 : orientation - 180;
    const tilt = bestSpace.tilt || 35;

    // Fetch PVGIS data
    const solarData = await fetchSolarData(location.lat, location.lng, tilt, pvgisAzimuth);

    // Calculate shadow factor
    const maxPossibleHours = 12; // Approximate max daily sun hours in UK summer
    const avgSunHours = bestSpace.avgDailyHours || 6;
    const shadowFactor = Math.min(1, avgSunHours / maxPossibleHours);

    // Adjust for shadows and kit wattage
    const adjusted = adjustForShadows(solarData, shadowFactor, selectedKit.wattage);

    // Calculate ROI
    const roi = calculateROI({
      kitCost: selectedKit.price,
      annualKwh: adjusted.annualKwh,
      warrantyYears: selectedKit.warrantyYears,
    });

    // Display results
    displayResults(roi, adjusted, bestSpace, selectedKit, solarData);

  } catch (error) {
    console.error('Results calculation failed:', error);
    showError('Failed to calculate results. Please try again.');
  }
}

function displayResults(roi, adjusted, bestSpace, kit, solarData) {
  // Hide loading, show content
  document.getElementById('results-loading')?.classList.add('hidden');
  document.getElementById('results-content')?.classList.remove('hidden');

  // Recommendation card
  const compassDir = getCompassDirection(bestSpace.orientation || 180);
  document.getElementById('recommendation-card').innerHTML = `
    <h3>⭐ Our Recommendation</h3>
    <p class="recommendation-text">
      Put your <strong>${kit.name}</strong> on your 
      <strong>${bestSpace.name || 'selected spot'}</strong> 
      facing <strong>${compassDir}</strong> at <strong>${bestSpace.tilt || 35}°</strong> tilt.
      ${bestSpace.avgDailyHours ? `This spot gets an average of <strong>${bestSpace.avgDailyHours} hours</strong> of direct sunlight per day.` : ''}
      You'll generate approximately <strong>${roi.annualKwhYear1} kWh</strong> in the first year, 
      saving <strong>${formatCurrency(roi.annualSavingsYear1)}</strong> annually.
    </p>
  `;

  // Key metrics
  document.getElementById('results-grid').innerHTML = `
    <div class="card result-card">
      <div class="result-icon">⚡</div>
      <div class="result-value accent" id="counter-kwh">${roi.annualKwhYear1}</div>
      <div class="result-label">kWh / year</div>
      <div class="result-sublabel">First year generation</div>
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
      <div class="result-value accent">${bestSpace.avgDailyHours || '~6'}h</div>
      <div class="result-label">Daily Sun Hours</div>
      <div class="result-sublabel">Average at best spot</div>
    </div>
  `;

  // Animate counters
  animateCounters();

  // Charts
  renderMonthlyChart(adjusted, solarData);
  renderSavingsChart(roi);
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

export function cleanup() {
  charts.forEach(c => c.destroy());
  charts = [];
}
