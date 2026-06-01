import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReferralClickPayload, trackReferralClick } from './referral-events.js';

const linkInfo = {
  url: 'https://wattpatch.co.uk/r/ecoflow-powerstream-400?campaign=results-primary',
  destinationUrl: 'https://uk.ecoflow.com/products/powerstream?utm_source=wattpatch',
  usesAffiliateLink: true,
  isTrackedRedirect: true,
  partnerId: 'ecoflow',
  partnerName: 'EcoFlow',
  trackingCampaign: 'results-primary',
};

const kit = {
  id: 'ecoflow-powerstream-400',
  brand: 'EcoFlow',
  name: 'PowerStream 400W Kit',
  hasBattery: false,
};

describe('buildReferralClickPayload', () => {
  it('keeps referral event payloads useful without storing personal data', () => {
    const payload = buildReferralClickPayload({
      linkInfo,
      kit,
      quoteContext: {
        quoteId: 'quote_123',
        assumptionMode: 'balanced',
        annualValue: 120.55,
        paybackYears: 4.25,
        ignored: undefined,
      },
      source: 'results-primary',
    });

    expect(payload).toMatchObject({
      eventType: 'referral_click',
      kitId: 'ecoflow-powerstream-400',
      kitBrand: 'EcoFlow',
      kitName: 'PowerStream 400W Kit',
      hasBattery: false,
      partnerId: 'ecoflow',
      partnerName: 'EcoFlow',
      campaign: 'results-primary',
      source: 'results-primary',
      destinationHost: 'uk.ecoflow.com',
      isTrackedRedirect: true,
      usesAffiliateLink: true,
      quote: {
        quoteId: 'quote_123',
        assumptionMode: 'balanced',
        annualValue: 120.55,
        paybackYears: 4.25,
      },
    });
    expect(payload.destinationUrl).toBeUndefined();
    expect(payload.userEmail).toBeUndefined();
  });
});

describe('trackReferralClick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when no tracking endpoint is configured', async () => {
    const transport = { sendBeacon: vi.fn(), fetch: vi.fn() };

    const result = await trackReferralClick({ linkInfo, kit, endpoint: '', transport });

    expect(result).toEqual({ attempted: false, method: 'none' });
    expect(transport.sendBeacon).not.toHaveBeenCalled();
    expect(transport.fetch).not.toHaveBeenCalled();
  });

  it('sends click payloads with sendBeacon when available', async () => {
    const transport = { sendBeacon: vi.fn(() => true), fetch: vi.fn() };

    const result = await trackReferralClick({
      linkInfo,
      kit,
      endpoint: '/api/referral-clicks',
      quoteContext: { quoteId: 'quote_123' },
      source: 'sticky-cta',
      transport,
    });

    expect(result).toEqual({ attempted: true, method: 'sendBeacon', ok: true });
    expect(transport.sendBeacon).toHaveBeenCalledTimes(1);
    expect(transport.fetch).not.toHaveBeenCalled();
    const [endpoint, blob] = transport.sendBeacon.mock.calls[0];
    expect(endpoint).toBe('/api/referral-clicks');
    expect(blob.type).toBe('application/json');
  });

  it('falls back to fetch keepalive when sendBeacon is unavailable', async () => {
    const transport = { fetch: vi.fn(() => Promise.resolve({ ok: true })) };

    const result = await trackReferralClick({
      linkInfo,
      kit,
      endpoint: '/api/referral-clicks',
      source: 'results-primary',
      transport,
    });

    expect(result).toEqual({ attempted: true, method: 'fetch', ok: true });
    expect(transport.fetch).toHaveBeenCalledWith('/api/referral-clicks', expect.objectContaining({
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }));
  });
});
