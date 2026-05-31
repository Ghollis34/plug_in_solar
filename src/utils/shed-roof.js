export function getShedRoofPlacementGuidance(obstacle, lat, lng, referenceLat = null) {
  const rotation = Number.isFinite(obstacle?.rotationDeg) ? obstacle.rotationDeg : 0;
  const longAxis = normalizeDegrees(rotation);
  const orientation = chooseSolarFacingBearing(lat, referenceLat, longAxis);

  return {
    orientation,
    displayRotation: longAxis,
    hint: `Aligned to shed roof · faces ${degreesToCompass(orientation)}`,
  };
}

function chooseSolarFacingBearing(lat, referenceLat, fallbackBearing) {
  const northernHemisphere = Number.isFinite(lat)
    ? lat >= 0
    : !Number.isFinite(referenceLat) || referenceLat >= 0;
  if (northernHemisphere) return 180;
  return 0;
}

function normalizeDegrees(value) {
  return ((Math.round(value) % 360) + 360) % 360;
}

function degreesToCompass(degrees) {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(normalizeDegrees(degrees) / 45) % 8];
}
