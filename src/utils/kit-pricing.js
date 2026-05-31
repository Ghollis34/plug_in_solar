import kitsData from '../data/kits.json';

const DEFAULT_PRICE_META = {
  status: 'catalogue',
  label: 'Guide price',
  detail: 'Catalogue guide price included with the app. Check the retailer before buying.',
};

export async function loadLivePricing(fetcher = globalThis.fetch, feedUrl = '/data/live-pricing.json') {
  if (typeof fetcher !== 'function') {
    return buildFallbackFeed();
  }

  try {
    const response = await fetcher(feedUrl, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });

    if (!response?.ok) {
      throw new Error(`Pricing feed unavailable: ${response?.status ?? 'unknown'}`);
    }

    return normalizePricingFeed(await response.json());
  } catch (error) {
    console.warn('Live pricing feed unavailable, using catalogue prices:', error.message);
    return buildFallbackFeed();
  }
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

function buildFallbackFeed() {
  return {
    status: 'fallback',
    updatedAt: new Date().toISOString(),
    kits: {},
  };
}

function normalizePricingFeed(feed) {
  if (!feed || typeof feed !== 'object' || !feed.kits || typeof feed.kits !== 'object') {
    return buildFallbackFeed();
  }

  const validKitIds = new Set(kitsData.map((kit) => kit.id));
  const kits = Object.fromEntries(Object.entries(feed.kits)
    .filter(([id, entry]) => validKitIds.has(id) && Number.isFinite(entry?.price) && entry.price > 0)
    .map(([id, entry]) => [id, {
      price: Math.round(entry.price * 100) / 100,
      detail: typeof entry.detail === 'string' ? entry.detail : undefined,
      priceMeta: entry.priceMeta && typeof entry.priceMeta === 'object' ? entry.priceMeta : undefined,
    }]));

  return {
    status: Object.keys(kits).length > 0 ? (feed.status || 'live') : 'fallback',
    updatedAt: typeof feed.updatedAt === 'string' ? feed.updatedAt : new Date().toISOString(),
    kits,
  };
}

function applyFeedPrice(kit, feed) {
  const feedEntry = feed?.kits?.[kit.id];
  const price = Number.isFinite(feedEntry?.price) ? feedEntry.price : kit.price;

  const feedMeta = feedEntry?.priceMeta || {};
  const feedStatus = feedMeta.status || (feed?.status === 'catalogue-snapshot' ? 'catalogue-snapshot' : 'live');
  const feedLabel = feedMeta.label || (feedStatus === 'live' ? 'Live price' : 'Catalogue snapshot');
  const feedDetail = feedMeta.detail || feedEntry?.detail || (feedStatus === 'live'
    ? 'Live retailer price loaded for this session.'
    : 'Generated catalogue snapshot loaded for this session. Check the retailer before buying.');

  return {
    ...kit,
    price,
    priceMeta: {
      ...DEFAULT_PRICE_META,
      ...feedMeta,
      ...(feedEntry ? { status: feedStatus, label: feedLabel, detail: feedDetail } : {}),
    },
  };
}
