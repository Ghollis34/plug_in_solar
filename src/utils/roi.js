import config from '../data/config.json';

/**
 * Calculate full ROI breakdown
 * @param {Object} params
 * @param {number} params.kitCost - Kit price in £
 * @param {number} params.annualKwh - Estimated annual generation in kWh
 * @param {number} [params.annualValuePerKwh] - Modelled value per generated kWh in £
 * @param {number} [params.annualFixedValue] - Modelled fixed yearly value not tied to solar kWh
 * @param {number} params.warrantyYears - Warranty period
 * @returns {Object} Full ROI breakdown
 */
export function calculateROI({ kitCost, annualKwh, annualValuePerKwh, annualFixedValue = 0, warrantyYears = 10 }) {
  const valuePerKwh = Number.isFinite(annualValuePerKwh) ? annualValuePerKwh : (config.electricityPrice / 100);
  const fixedAnnualValue = Number.isFinite(annualFixedValue) ? annualFixedValue : 0;
  const degradation = config.panelDegradation;
  const annualValueGrowthRate = clamp(config.annualValueGrowthRate ?? 0, 0, 0.15);
  
  // Annual savings in first year
  const annualSavingsYear1 = (annualKwh * valuePerKwh) + fixedAnnualValue;
  
  // Payback period (accounting for degradation)
  let paybackYears = 0;
  let cumSavings = 0;
  let foundPayback = false;
  
  // 25-year projection
  const yearlyData = [];
  
  for (let year = 1; year <= 25; year++) {
    const degradationFactor = Math.pow(1 - degradation, year - 1);
    const valueGrowthFactor = Math.pow(1 + annualValueGrowthRate, year - 1);
    const yearKwh = annualKwh * degradationFactor;
    const yearSavings = ((yearKwh * valuePerKwh) + fixedAnnualValue) * valueGrowthFactor;
    cumSavings += yearSavings;
    
    yearlyData.push({
      year,
      kwhGenerated: Math.round(yearKwh * 10) / 10,
      savings: Math.round(yearSavings * 100) / 100,
      cumulativeSavings: Math.round(cumSavings * 100) / 100,
      netReturn: Math.round((cumSavings - kitCost) * 100) / 100,
      co2Saved: Math.round(yearKwh * config.co2PerKwh * 10) / 10,
    });
    
    if (!foundPayback && cumSavings >= kitCost) {
      // Interpolate to find exact payback point
      const prevCum = cumSavings - yearSavings;
      const remaining = kitCost - prevCum;
      const fractionOfYear = remaining / yearSavings;
      paybackYears = (year - 1) + fractionOfYear;
      foundPayback = true;
    }
  }
  
  if (!foundPayback) {
    paybackYears = null; // Never pays back (shouldn't happen with solar)
  }
  
  // Summary stats
  const totalKwh25yr = yearlyData.reduce((sum, y) => sum + y.kwhGenerated, 0);
  const totalSavings25yr = yearlyData[24].cumulativeSavings;
  const totalCo2_25yr = yearlyData.reduce((sum, y) => sum + y.co2Saved, 0);
  const netReturn25yr = totalSavings25yr - kitCost;
  
  const totalSavings10yr = yearlyData[9].cumulativeSavings;
  const netReturn10yr = totalSavings10yr - kitCost;
  
  // ROI percentage
  const roiPercent = ((totalSavings25yr - kitCost) / kitCost) * 100;
  
  return {
    // Key metrics
    annualSavingsYear1: Math.round(annualSavingsYear1 * 100) / 100,
    annualKwhYear1: Math.round(annualKwh * 10) / 10,
    paybackYears: paybackYears ? Math.round(paybackYears * 10) / 10 : null,
    paybackMonths: paybackYears ? Math.round(paybackYears * 12) : null,
    
    // 10 year
    totalSavings10yr: Math.round(totalSavings10yr * 100) / 100,
    netReturn10yr: Math.round(netReturn10yr * 100) / 100,
    
    // 25 year
    totalSavings25yr: Math.round(totalSavings25yr * 100) / 100,
    netReturn25yr: Math.round(netReturn25yr * 100) / 100,
    totalKwh25yr: Math.round(totalKwh25yr),
    totalCo2_25yr: Math.round(totalCo2_25yr),
    roiPercent: Math.round(roiPercent),
    
    // Yearly breakdown for charts
    yearlyData,
    
    // Config used
    electricityPrice: config.electricityPrice,
    electricityPriceSource: config.electricityPriceSource,
    valuePerKwh: Math.round(valuePerKwh * 10000) / 10000,
    annualFixedValue: Math.round(fixedAnnualValue * 100) / 100,
    annualValueGrowthRate,
    kitCost,
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount) {
  return `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format payback period for display
 */
export function formatPayback(years) {
  if (!years) return 'N/A';
  const fullYears = Math.floor(years);
  const months = Math.round((years - fullYears) * 12);
  if (fullYears === 0) return `${months} months`;
  if (months === 0) return `${fullYears} years`;
  return `${fullYears} years ${months} months`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
