const DEFAULT_RECOMMENDED_LIMIT = 3;

export function splitRecommendedKits(items, { showAll = false, limit = DEFAULT_RECOMMENDED_LIMIT } = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeLimit = Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_RECOMMENDED_LIMIT);
  const recommended = safeItems.slice(0, safeLimit);
  const remaining = safeItems.slice(safeLimit);

  return {
    recommended,
    extra: showAll ? remaining : [],
    hiddenCount: showAll ? 0 : remaining.length,
    isLimited: !showAll && remaining.length > 0,
  };
}
