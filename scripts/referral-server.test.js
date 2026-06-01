import { describe, expect, it } from 'vitest';
import {
  buildReferralSummary,
  normaliseReferralClick,
  resolveReferralDestination,
} from './referral-server.mjs';

const referrals = {
  partners: {
    ecoflow: {
      name: 'EcoFlow',
      status: 'affiliate',
      allowedHosts: ['uk.ecoflow.com'],
      defaultLabel: 'View EcoFlow partner offer',
      trackingType: 'url-template',
      urlTemplate: 'https://uk.ecoflow.com/products/{slug}?utm_source=wattpatch&utm_medium=referral&utm_campaign={campaign}',
    },
  },
  kits: {
    'ecoflow-powerstream-400': {
      partner: 'ecoflow',
      slug: 'powerstream-microinverter',
    },
  },
};

const kits = [
  {
    id: 'ecoflow-powerstream-400',
    brand: 'EcoFlow',
    name: 'PowerStream 400W Kit',
    storeUrl: 'https://uk.ecoflow.com/products/fallback',
  },
];

describe('resolveReferralDestination', () => {
  it('resolves configured kit destinations without trusting request URLs', () => {
    const destination = resolveReferralDestination({
      kitId: 'ecoflow-powerstream-400',
      campaign: 'launch email',
      referrals,
      kits,
    });

    expect(destination).toMatchObject({
      ok: true,
      kitId: 'ecoflow-powerstream-400',
      partnerId: 'ecoflow',
      partnerName: 'EcoFlow',
      destinationUrl: 'https://uk.ecoflow.com/products/powerstream-microinverter?utm_source=wattpatch&utm_medium=referral&utm_campaign=launch+email',
    });
  });

  it('returns a not-found result for unknown kits', () => {
    expect(resolveReferralDestination({ kitId: 'missing-kit', referrals, kits })).toMatchObject({
      ok: false,
      statusCode: 404,
    });
  });
});

describe('normaliseReferralClick', () => {
  it('keeps useful analytics fields and drops accidental PII-like fields', () => {
    const event = normaliseReferralClick({
      kitId: 'ecoflow-powerstream-400',
      partnerId: 'ecoflow',
      campaign: 'results-primary',
      destinationUrl: 'https://uk.ecoflow.com/private-path',
      quote: { quoteId: 'quote_123', annualValue: 100, paybackYears: 4.5 },
      email: 'customer@example.com',
      postcode: 'AB12 3CD',
    });

    expect(event).toMatchObject({
      eventType: 'referral_click',
      kitId: 'ecoflow-powerstream-400',
      partnerId: 'ecoflow',
      campaign: 'results-primary',
      destinationHost: 'uk.ecoflow.com',
      quote: { quoteId: 'quote_123', annualValue: 100, paybackYears: 4.5 },
    });
    expect(event.destinationUrl).toBeUndefined();
    expect(event.email).toBeUndefined();
    expect(event.postcode).toBeUndefined();
  });
});

describe('buildReferralSummary', () => {
  it('summarises clicks by kit and partner for easy tracking', () => {
    const summary = buildReferralSummary([
      { kitId: 'ecoflow-powerstream-400', partnerId: 'ecoflow', campaign: 'results-primary' },
      { kitId: 'ecoflow-powerstream-400', partnerId: 'ecoflow', campaign: 'sticky-cta' },
      { kitId: 'anker-solix-400', partnerId: 'anker', campaign: 'results-primary' },
    ]);

    expect(summary.totalClicks).toBe(3);
    expect(summary.byKit).toEqual({
      'ecoflow-powerstream-400': 2,
      'anker-solix-400': 1,
    });
    expect(summary.byPartner).toEqual({ ecoflow: 2, anker: 1 });
    expect(summary.byCampaign).toEqual({ 'results-primary': 2, 'sticky-cta': 1 });
  });
});
