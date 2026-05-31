export const ALLOWED_RETAILER_HOSTS = [
  'uk.ecoflow.com',
  'ecoflow.com',
  'thunderenergy.co.uk',
  'zendure.com',
  'uk.zendure.com',
  'amazon.co.uk',
];

export function resolveRetailerLink(url) {
  const safeUrl = normaliseRetailerUrl(url);
  return {
    url: safeUrl,
    usesAffiliateLink: false,
    label: safeUrl ? 'Retailer website' : 'Retailer link unavailable',
  };
}

function normaliseRetailerUrl(url) {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (parsed.protocol !== 'https:') return '';
    if (!ALLOWED_RETAILER_HOSTS.includes(host)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}
