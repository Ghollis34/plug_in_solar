import SunCalc from 'suncalc';
import config from '../data/config.json';

/**
 * Get sun position (altitude & azimuth) for a given time and location
 */
export function getSunPosition(date, lat, lng) {
  const pos = SunCalc.getPosition(date, lat, lng);
  return {
    altitude: pos.altitude,        // radians above horizon
    altitudeDeg: pos.altitude * (180 / Math.PI),
    azimuth: pos.azimuth,          // radians from south
    azimuthDeg: pos.azimuth * (180 / Math.PI) + 180, // degrees from north (0-360)
  };
}

/**
 * Get sun times (sunrise, sunset, solar noon, etc.)
 */
export function getSunTimes(date, lat, lng) {
  return SunCalc.getTimes(date, lat, lng);
}

/**
 * Calculate shadow length for a given object height and sun altitude
 */
export function getShadowLength(height, sunAltitude) {
  if (sunAltitude <= 0) return Infinity; // Sun below horizon
  return height / Math.tan(sunAltitude);
}

/**
 * Calculate shadow direction (bearing from object, degrees from north)
 */
export function getShadowDirection(sunAzimuth) {
  // Shadow falls opposite to sun direction
  // sunAzimuth is in radians from south, clockwise
  let dirDeg = (sunAzimuth * (180 / Math.PI)) + 180; // opposite direction
  dirDeg = ((dirDeg % 360) + 360) % 360; // normalize to 0-360
  return dirDeg;
}

/**
 * Calculate building height from floors and roof type
 */
export function calcBuildingHeight(floors, pitched = false) {
  const baseHeight = floors * config.floorHeight;
  return pitched ? baseHeight + config.pitchedRoofAddition : baseHeight;
}

/**
 * Get MapLibre light properties matching the sun position
 * Returns properties suitable for setting map light
 */
export function getMapLightFromSun(date, lat, lng) {
  const pos = getSunPosition(date, lat, lng);
  
  // MapLibre anchor: map, position: [azimuthal angle, polar angle, radial distance]
  // Azimuthal from north (0-360), polar from zenith (0 = directly above, 90 = horizon)
  const azimuthal = pos.azimuthDeg;
  const polar = 90 - pos.altitudeDeg; // Convert altitude to polar angle from zenith
  
  // Intensity based on sun altitude
  const intensity = Math.max(0, Math.min(1, pos.altitudeDeg / 60));
  
  // Color temperature: warm at sunrise/sunset, white at noon
  let color;
  if (pos.altitudeDeg < 5) {
    color = '#ff6b35'; // Deep orange (very low sun)
  } else if (pos.altitudeDeg < 15) {
    color = '#ffaa55'; // Warm orange
  } else if (pos.altitudeDeg < 30) {
    color = '#ffd699'; // Warm white
  } else {
    color = '#ffffff'; // Full white (midday)
  }

  return {
    anchor: 'map',
    position: [1.5, azimuthal, polar],
    intensity: Math.max(0.2, intensity),
    color,
    isSunUp: pos.altitudeDeg > 0
  };
}

/**
 * Calculate sun hours for a point across a full day
 * Checks every 15-minute interval if the point is in shadow from nearby buildings
 * Returns estimated direct sun hours
 */
export function calcDailySunHours(date, lat, lng, pointLat, pointLng, buildings = []) {
  const times = getSunTimes(date, lat, lng);
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  
  if (!sunrise || !sunset) return 0;
  
  let sunMinutes = 0;
  const interval = 15; // minutes
  const current = new Date(sunrise);
  
  while (current <= sunset) {
    const pos = getSunPosition(current, lat, lng);
    
    if (pos.altitudeDeg > 0) {
      let inShadow = false;
      
      // Check if any building casts shadow on this point
      for (const building of buildings) {
        if (isPointInBuildingShadow(
          pointLat, pointLng,
          building.lat, building.lng,
          building.height,
          building.footprintRadius || 5,
          pos
        )) {
          inShadow = true;
          break;
        }
      }
      
      if (!inShadow) {
        sunMinutes += interval;
      }
    }
    
    current.setMinutes(current.getMinutes() + interval);
  }
  
  return sunMinutes / 60;
}

/**
 * Check if a point is in the shadow of a building
 * Simplified geometric check
 */
function isPointInBuildingShadow(pointLat, pointLng, buildingLat, buildingLng, buildingHeight, footprintRadius, sunPos) {
  if (sunPos.altitudeDeg <= 0) return true; // Dark
  
  const shadowLen = getShadowLength(buildingHeight, sunPos.altitude);
  if (shadowLen === Infinity) return true;
  
  // Shadow direction (from building towards shadow)
  const shadowDirRad = sunPos.azimuth + Math.PI; // Opposite to sun
  
  // Calculate shadow tip position relative to building (in meters)
  const shadowTipDx = Math.sin(shadowDirRad) * shadowLen;
  const shadowTipDy = Math.cos(shadowDirRad) * shadowLen;
  
  // Convert point position relative to building (approximate meters from lat/lng)
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(buildingLat * Math.PI / 180);
  
  const dx = (pointLng - buildingLng) * mPerDegLng;
  const dy = (pointLat - buildingLat) * mPerDegLat;
  
  // Check if point is within the shadow cone
  // Simplified: check if point is between building and shadow tip, within spread
  const shadowVecLen = Math.sqrt(shadowTipDx * shadowTipDx + shadowTipDy * shadowTipDy);
  if (shadowVecLen < 0.01) return false;
  
  // Project point onto shadow direction
  const dot = (dx * shadowTipDx + dy * shadowTipDy) / (shadowVecLen * shadowVecLen);
  
  if (dot < 0 || dot > 1) return false; // Not in shadow range
  
  // Distance from shadow center line
  const projX = shadowTipDx * dot;
  const projY = shadowTipDy * dot;
  const perpDist = Math.sqrt((dx - projX) ** 2 + (dy - projY) ** 2);
  
  // Shadow width tapers from footprint radius to 0 at tip
  const widthAtPoint = footprintRadius * (1 - dot * 0.5);
  
  return perpDist <= widthAtPoint;
}

/**
 * Calculate average daily sun hours for each month
 * Uses the 15th of each month as representative day
 */
export function calcMonthlySunHours(lat, lng, pointLat, pointLng, buildings = []) {
  const monthly = [];
  const year = new Date().getFullYear();
  
  for (let month = 0; month < 12; month++) {
    const date = new Date(year, month, 15);
    const hours = calcDailySunHours(date, lat, lng, pointLat, pointLng, buildings);
    monthly.push({
      month: date.toLocaleString('en-GB', { month: 'short' }),
      hours: Math.round(hours * 10) / 10
    });
  }
  
  return monthly;
}

/**
 * Score and rank multiple spaces by sun exposure
 * Returns sorted array with scores (best first)
 */
export function rankSpaces(lat, lng, spaces, buildings = []) {
  const scored = spaces.map(space => {
    // Use centre of the space polygon
    const centerLat = space.centerLat || lat;
    const centerLng = space.centerLng || lng;
    
    const monthly = calcMonthlySunHours(lat, lng, centerLat, centerLng, buildings);
    const avgDailyHours = monthly.reduce((sum, m) => sum + m.hours, 0) / 12;
    const annualHours = monthly.reduce((sum, m) => sum + m.hours * 30, 0); // approx
    
    // Score: weighted towards summer months (when generation is highest)
    const summerWeight = [0.6, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7, 0.6];
    const weightedScore = monthly.reduce((sum, m, i) => sum + m.hours * summerWeight[i], 0) / 12;
    
    return {
      ...space,
      monthly,
      avgDailyHours: Math.round(avgDailyHours * 10) / 10,
      annualHours: Math.round(annualHours),
      score: Math.round(weightedScore * 100) / 100,
    };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored;
}

/**
 * Get sun positions for a full day at intervals (for animation)
 */
export function getDayPath(date, lat, lng, intervalMinutes = 15) {
  const times = getSunTimes(date, lat, lng);
  const positions = [];
  
  // Start a bit before sunrise, end a bit after sunset
  const start = new Date(times.sunrise);
  start.setMinutes(start.getMinutes() - 30);
  const end = new Date(times.sunset);
  end.setMinutes(end.getMinutes() + 30);
  
  const current = new Date(start);
  while (current <= end) {
    const pos = getSunPosition(current, lat, lng);
    positions.push({
      time: new Date(current),
      timeStr: current.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      ...pos,
    });
    current.setMinutes(current.getMinutes() + intervalMinutes);
  }
  
  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    solarNoon: times.solarNoon,
    positions
  };
}
