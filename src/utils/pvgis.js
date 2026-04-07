import config from '../data/config.json';

const PVGIS_BASE = 'https://re.jrc.ec.europa.eu/api/v5_3';

/**
 * Fetch hourly solar radiation data from PVGIS for a given location
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude 
 * @param {number} tilt - Panel tilt angle (0-90, 0=horizontal)
 * @param {number} azimuth - Panel azimuth (-180 to 180, 0=south, -90=east, 90=west)
 * @returns {Promise<Object>} Monthly and annual generation data
 */
export async function fetchSolarData(lat, lng, tilt = 35, azimuth = 0) {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lng.toFixed(4),
    angle: tilt.toString(),
    aspect: azimuth.toString(),
    outputformat: 'json',
    pvcalculation: '1',
    peakpower: '1',       // 1 kWp for normalised output
    loss: '14',            // System losses (cables, inverter etc.)
    mountingplace: 'building',
  });

  const url = `${PVGIS_BASE}/PVcalc?${params}`;

  try {
    // Try direct request first
    let response;
    try {
      response = await fetch(url);
    } catch (e) {
      // If CORS blocks it, try through a proxy
      response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    }
    
    if (!response.ok) {
      throw new Error(`PVGIS API error: ${response.status}`);
    }
    
    const data = await response.json();
    return parsePVGISResponse(data);
  } catch (error) {
    console.warn('PVGIS fetch failed, using UK fallback data:', error.message);
    // Return estimated fallback data for UK
    return getUKFallbackData(lat);
  }
}

/**
 * Parse PVGIS API response into usable format
 */
function parsePVGISResponse(data) {
  const outputs = data.outputs;
  const monthly = outputs.monthly.fixed;
  
  const months = monthly.map(m => ({
    month: m.month,
    monthName: getMonthName(m.month),
    kwhPerKwp: Math.round(m.E_m * 10) / 10,      // Monthly kWh per kWp
    irradiation: Math.round(m.H_m * 10) / 10,     // Monthly irradiation kWh/m²
    avgDailyKwh: Math.round(m.E_d * 100) / 100,   // Average daily kWh per kWp
  }));

  const annual = {
    kwhPerKwp: Math.round(outputs.totals.fixed.E_y * 10) / 10,  // Annual kWh per kWp
    irradiation: Math.round(outputs.totals.fixed.H_y * 10) / 10, // Annual irradiation
    avgDailyKwh: Math.round(outputs.totals.fixed.E_d * 100) / 100,
  };

  return { months, annual };
}

/**
 * Fallback data for UK locations when PVGIS is unavailable
 * Based on average UK solar irradiance data
 */
function getUKFallbackData(lat) {
  // UK average annual kWh per kWp varies by latitude
  // Southern England ~900, Midlands ~850, Scotland ~800
  const baseKwh = lat > 55 ? 800 : lat > 52 ? 850 : 900;
  
  // Monthly distribution (approximate UK pattern)
  const monthlyDistribution = [0.03, 0.04, 0.07, 0.10, 0.12, 0.13, 0.13, 0.11, 0.09, 0.07, 0.04, 0.03];
  
  const months = monthlyDistribution.map((ratio, i) => ({
    month: i + 1,
    monthName: getMonthName(i + 1),
    kwhPerKwp: Math.round(baseKwh * ratio * 10) / 10,
    irradiation: Math.round(baseKwh * ratio * 1.1 * 10) / 10,
    avgDailyKwh: Math.round((baseKwh * ratio / 30) * 100) / 100,
  }));

  return {
    months,
    annual: {
      kwhPerKwp: baseKwh,
      irradiation: Math.round(baseKwh * 1.1),
      avgDailyKwh: Math.round((baseKwh / 365) * 100) / 100,
    },
    isFallback: true,
  };
}

/**
 * Adjust PVGIS output based on shadow analysis
 * @param {Object} solarData - PVGIS data
 * @param {number} shadowFactor - Fraction of available sunlight (0-1)
 * @param {number} kitWattage - Kit wattage in W (e.g. 800)
 * @returns {Object} Adjusted generation data
 */
export function adjustForShadows(solarData, shadowFactor, kitWattage) {
  const kwp = kitWattage / 1000;
  
  const months = solarData.months.map(m => ({
    ...m,
    adjustedKwh: Math.round(m.kwhPerKwp * kwp * shadowFactor * 10) / 10,
  }));

  const annualKwh = Math.round(solarData.annual.kwhPerKwp * kwp * shadowFactor * 10) / 10;

  return {
    months,
    annualKwh,
    shadowFactor,
    kwp,
  };
}

function getMonthName(monthNum) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[monthNum - 1] || '';
}
