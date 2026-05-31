export function getShadowGuidance(space, recommended) {
  if (!space) {
    return {
      level: 'pending',
      title: 'Checking sunlight',
      summary: 'We are comparing the panel spots you marked and estimating how much shade may affect them.',
      action: 'Keep the shadow map open while the estimate finishes.',
    };
  }

  const shadowFactor = Number.isFinite(space.shadowFactor) ? space.shadowFactor : 0;
  const dailyHours = Number.isFinite(space.avgDailyHours) ? space.avgDailyHours : parseFloat(space.avgDailyHours) || 0;
  const warningLevel = space.warningLevel === 'high' || space.warningLevel === 'medium' ? space.warningLevel : 'low';
  const isRecommended = !recommended || space.id === recommended.id;

  if (warningLevel === 'high' || shadowFactor < 0.55 || dailyHours < 3) {
    return {
      level: 'high',
      title: 'High shade risk',
      summary: 'This spot may not get enough direct sunlight for the best plug-in solar result.',
      action: isRecommended
        ? 'You can continue with this estimate, but trying another roof, wall, balcony, or garden spot may improve the recommendation.'
        : `Try ${recommended.name} if you want to use the sunniest marked spot, or continue with this estimate.`,
    };
  }

  if (warningLevel === 'medium' || shadowFactor < 0.72 || dailyHours < 4.5) {
    return {
      level: 'medium',
      title: 'Some shade risk',
      summary: 'This spot should still be usable, but nearby trees, fences, or buildings may reduce output at certain times.',
      action: isRecommended
        ? 'Continue if this is where you would actually place the panels, or try another spot to compare.'
        : `The sunniest marked spot is ${recommended.name}. You can switch to it, compare visually, or continue with this choice.`,
    };
  }

  return {
    level: 'low',
    title: 'Good sunlight',
    summary: 'This spot looks suitable for plug-in solar and has strong estimated direct sun across the year.',
    action: isRecommended
      ? 'This is a good spot to use for the kit recommendation.'
      : `This looks workable. ${recommended.name} appears slightly sunnier, but you can continue with either spot.`,
  };
}
