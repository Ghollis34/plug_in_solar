export const ALLOWED_RETAILER_HOSTS = [
  'uk.ecoflow.com',
  'ecoflow.com',
  'thunderenergy.co.uk',
  'zendure.com',
  'uk.zendure.com',
  'anker.com',
  'amazon.co.uk',
];

export function resolveRetailerLink(input, options = {}) {
  if (typeof input === 'string') {
    return buildDirectLink(input);
  }

  const kit = input && typeof input === 'object' ? input : null;
  if (!kit) return unavailableLink();

  const referralConfig = options.referralConfig || {};
  const campaign = normaliseCampaign(options.campaign || 'results');
  const kitReferral = referralConfig.kits?.[kit.id] || null;
  const configuredPartner = kitReferral?.partner ? referralConfig.partners?.[kitReferral.partner] : null;

  if (kitReferral && configuredPartner && configuredPartner.status === 'affiliate') {
    const destinationUrl = buildPartnerDestinationUrl({ kit, kitReferral, partner: configuredPartner, campaign });
    const safeDestination = normaliseRetailerUrl(destinationUrl, configuredPartner.allowedHosts);
    if (safeDestination) {
      const redirectUrl = buildReferralRedirectUrl(options.redirectBaseUrl, kit.id, campaign);
      return removeEmptyFields({
        url: redirectUrl || safeDestination,
        destinationUrl: safeDestination,
        usesAffiliateLink: true,
        isTrackedRedirect: Boolean(redirectUrl),
        partnerId: kitReferral.partner,
        partnerName: configuredPartner.name,
        trackingCampaign: campaign,
        label: configuredPartner.defaultLabel || `View ${configuredPartner.name || kit.brand || 'Partner'} offer`,
        disclosure: referralConfig.disclosure,
      });
    }
  }

  const directUrl = normaliseRetailerUrl(kit.storeUrl, collectAllowedHosts(referralConfig));
  if (!directUrl) return unavailableLink();

  const matchedPartner = findPartnerForUrl(directUrl, referralConfig);
  return removeEmptyFields({
    url: directUrl,
    destinationUrl: directUrl,
    usesAffiliateLink: false,
    isTrackedRedirect: false,
    partnerId: kitReferral?.partner || matchedPartner?.id,
    partnerName: configuredPartner?.name || matchedPartner?.partner?.name,
    trackingCampaign: campaign,
    label: configuredPartner?.defaultLabel || matchedPartner?.partner?.defaultLabel || 'Retailer website',
    disclosure: referralConfig.disclosure,
  });
}

export function buildReferralRedirectUrl(baseUrl, kitId, campaign) {
  if (!baseUrl || !kitId || typeof baseUrl !== 'string') return '';

  try {
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:') return '';
    const path = `${base.pathname.replace(/\/+$/, '')}/${encodeURIComponent(String(kitId))}`;
    base.pathname = path;
    base.search = '';
    if (campaign) base.searchParams.set('campaign', normaliseCampaign(campaign));
    return base.toString();
  } catch {
    return '';
  }
}

function buildDirectLink(url) {
  const safeUrl = normaliseRetailerUrl(url, ALLOWED_RETAILER_HOSTS);
  return {
    url: safeUrl,
    destinationUrl: safeUrl,
    usesAffiliateLink: false,
    isTrackedRedirect: false,
    label: safeUrl ? 'Retailer website' : 'Retailer link unavailable',
  };
}

function unavailableLink() {
  return {
    url: '',
    usesAffiliateLink: false,
    isTrackedRedirect: false,
    label: 'Retailer link unavailable',
  };
}

function buildPartnerDestinationUrl({ kit, kitReferral, partner, campaign }) {
  if (partner.trackingType === 'url-template' && partner.urlTemplate) {
    return partner.urlTemplate
      .replaceAll('{slug}', encodeTemplateValue(kitReferral.slug || kit.id))
      .replaceAll('{kitId}', encodeTemplateValue(kit.id))
      .replaceAll('{campaign}', encodeTemplateValue(campaign));
  }

  if (partner.trackingType === 'amazon-tag' && kitReferral.asin && partner.tag) {
    const url = new URL(`https://www.amazon.co.uk/dp/${encodeURIComponent(kitReferral.asin)}`);
    url.searchParams.set('tag', partner.tag);
    url.searchParams.set('ascsubtag', campaign);
    return url.toString();
  }

  return kitReferral.url || kit.storeUrl || '';
}

function normaliseRetailerUrl(url, allowedHosts = ALLOWED_RETAILER_HOSTS) {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    const host = normaliseHost(parsed.hostname);
    if (parsed.protocol !== 'https:') return '';
    if (!allowedHosts.map(normaliseHost).includes(host)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function collectAllowedHosts(referralConfig) {
  const configuredHosts = Object.values(referralConfig.partners || {})
    .flatMap((partner) => Array.isArray(partner.allowedHosts) ? partner.allowedHosts : []);
  return [...new Set([...ALLOWED_RETAILER_HOSTS, ...configuredHosts])];
}

function findPartnerForUrl(url, referralConfig) {
  const host = getUrlHost(url);
  if (!host) return null;
  for (const [id, partner] of Object.entries(referralConfig.partners || {})) {
    const allowedHosts = Array.isArray(partner.allowedHosts) ? partner.allowedHosts : [];
    if (allowedHosts.map(normaliseHost).includes(host)) {
      return { id, partner };
    }
  }
  return null;
}

function getUrlHost(url) {
  try {
    return normaliseHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

function normaliseHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function normaliseCampaign(campaign) {
  return String(campaign || 'results').trim().slice(0, 80) || 'results';
}

function encodeTemplateValue(value) {
  return encodeURIComponent(String(value ?? '')).replace(/%20/g, '+');
}

function removeEmptyFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
  );
}
