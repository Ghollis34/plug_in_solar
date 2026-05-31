import kitsData from '../data/kits.json';

const DEFAULT_PRICE_META = {
  status: 'catalogue',
  label: 'Guide price',
  detail: 'Catalogue guide price included with the app. Check the retailer before buying.',
};

export async function loadLivePricing() {
  return {
    status: 'fallback',
    updatedAt: new Date().toISOString(),
    kits: {},
  };
}

export function getPricedKits(feed = null, { spaceType = null } = {}) {
  return kitsData
    .filter((kit) => !spaceType || kit.mountingTypes?.includes(spaceType))
    .map((kit) => applyFeedPrice(kit, feed));
}

export function findPricedKitById(kitOrId, feed = null, options = {}) {
  const id = typeof kitOrId === 'string' ? kitOrId : kitOrId?.id;
  if (!id) return null;
  return getPricedKits(feed, options).find((kit) => kit.id === id) || null;
}

export function getKitPriceStatusLabel(priceMeta = null) {
  return priceMeta?.label || DEFAULT_PRICE_META.label;
}

export function getKitPriceDetailLabel(priceMeta = null) {
  return priceMeta?.detail || DEFAULT_PRICE_META.detail;
}

function applyFeedPrice(kit, feed) {
  const feedEntry = feed?.kits?.[kit.id];
  const price = Number.isFinite(feedEntry?.price) ? feedEntry.price : kit.price;

  return {
    ...kit,
    price,
    priceMeta: {
      ...DEFAULT_PRICE_META,
      ...(feedEntry?.priceMeta || {}),
      ...(feedEntry ? { status: 'live', label: 'Live price', detail: feedEntry.detail || 'Live retailer price loaded for this session.' } : {}),
    },
  };
}
