export function buildReferralClickPayload({ linkInfo, kit, quoteContext = {}, source = 'results' } = {}) {
  const destinationHost = getHost(linkInfo?.destinationUrl || linkInfo?.url);
  const quote = removeEmptyFields({
    quoteId: quoteContext.quoteId,
    assumptionMode: quoteContext.assumptionMode,
    annualValue: quoteContext.annualValue,
    paybackYears: quoteContext.paybackYears,
    annualKwh: quoteContext.annualKwh,
    hasBattery: quoteContext.hasBattery,
  });

  return removeEmptyFields({
    eventType: 'referral_click',
    kitId: kit?.id,
    kitBrand: kit?.brand,
    kitName: kit?.name,
    hasBattery: kit?.hasBattery,
    partnerId: linkInfo?.partnerId,
    partnerName: linkInfo?.partnerName,
    campaign: linkInfo?.trackingCampaign,
    source,
    destinationHost,
    isTrackedRedirect: Boolean(linkInfo?.isTrackedRedirect),
    usesAffiliateLink: Boolean(linkInfo?.usesAffiliateLink),
    quote,
  });
}

export async function trackReferralClick({
  linkInfo,
  kit,
  endpoint,
  quoteContext = {},
  source = 'results',
  transport = getDefaultTransport(),
} = {}) {
  if (!endpoint || typeof endpoint !== 'string') {
    return { attempted: false, method: 'none' };
  }

  const payload = buildReferralClickPayload({ linkInfo, kit, quoteContext, source });
  const json = JSON.stringify(payload);

  if (typeof transport?.sendBeacon === 'function') {
    const blob = new Blob([json], { type: 'application/json' });
    const ok = transport.sendBeacon(endpoint, blob);
    return { attempted: true, method: 'sendBeacon', ok: Boolean(ok) };
  }

  if (typeof transport?.fetch === 'function') {
    try {
      const response = await transport.fetch(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      return { attempted: true, method: 'fetch', ok: Boolean(response?.ok) };
    } catch {
      return { attempted: true, method: 'fetch', ok: false };
    }
  }

  return { attempted: false, method: 'none' };
}

function getDefaultTransport() {
  return {
    sendBeacon: typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : undefined,
    fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
  };
}

function getHost(url) {
  if (!url || typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function removeEmptyFields(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
  );
}
