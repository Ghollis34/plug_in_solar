import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RETAILER_HOSTS,
  buildReferralRedirectUrl,
  resolveRetailerLink,
} from './referrals.js';

const referralConfig = {
  disclosure: 'WattPatch may earn a commission from selected partner links.',
  partners: {
    ecoflow: {
      name: 'EcoFlow',
      status: 'affiliate',
      allowedHosts: ['uk.ecoflow.com', 'ecoflow.com'],
      defaultLabel: 'View EcoFlow partner offer',
      trackingType: 'url-template',
      urlTemplate: 'https://uk.ecoflow.com/products/{slug}?utm_source=wattpatch&utm_medium=referral&utm_campaign={campaign}',
    },
    anker: {
      name: 'Anker SOLIX',
      status: 'direct',
      allowedHosts: ['anker.com'],
      defaultLabel: 'View Anker store',
      trackingType: 'direct',
    },
  },
  kits: {
    'ecoflow-powerstream-400': {
      partner: 'ecoflow',
      slug: 'powerstream-microinverter',
    },
  },
};

describe('retailer referral links', () => {
  it('allows known kit retailer hosts and returns a safe direct link by default', () => {
    const link = resolveRetailerLink('https://uk.ecoflow.com/products/example');

    expect(ALLOWED_RETAILER_HOSTS).toContain('uk.ecoflow.com');
    expect(link).toMatchObject({
      url: 'https://uk.ecoflow.com/products/example',
      usesAffiliateLink: false,
    });
  });

  it('allows Anker UK kit URLs after normalising www hosts', () => {
    const link = resolveRetailerLink('https://www.anker.com/uk/products/example');

    expect(ALLOWED_RETAILER_HOSTS).toContain('anker.com');
    expect(link).toMatchObject({
      url: 'https://www.anker.com/uk/products/example',
      usesAffiliateLink: false,
      label: 'Retailer website',
    });
  });

  it('builds configured affiliate links with campaign placeholders', () => {
    const link = resolveRetailerLink(
      {
        id: 'ecoflow-powerstream-400',
        brand: 'EcoFlow',
        storeUrl: 'https://uk.ecoflow.com/products/fallback',
      },
      { referralConfig, campaign: 'results-primary' }
    );

    expect(link).toMatchObject({
      url: 'https://uk.ecoflow.com/products/powerstream-microinverter?utm_source=wattpatch&utm_medium=referral&utm_campaign=results-primary',
      destinationUrl: 'https://uk.ecoflow.com/products/powerstream-microinverter?utm_source=wattpatch&utm_medium=referral&utm_campaign=results-primary',
      usesAffiliateLink: true,
      isTrackedRedirect: false,
      partnerId: 'ecoflow',
      partnerName: 'EcoFlow',
      label: 'View EcoFlow partner offer',
      disclosure: referralConfig.disclosure,
    });
  });

  it('can point affiliate clicks at a tracked redirect endpoint', () => {
    const link = resolveRetailerLink(
      {
        id: 'ecoflow-powerstream-400',
        brand: 'EcoFlow',
        storeUrl: 'https://uk.ecoflow.com/products/fallback',
      },
      {
        referralConfig,
        campaign: 'sticky-cta',
        redirectBaseUrl: 'https://wattpatch.co.uk/r',
      }
    );

    expect(link.url).toBe('https://wattpatch.co.uk/r/ecoflow-powerstream-400?campaign=sticky-cta');
    expect(link.destinationUrl).toBe('https://uk.ecoflow.com/products/powerstream-microinverter?utm_source=wattpatch&utm_medium=referral&utm_campaign=sticky-cta');
    expect(link.isTrackedRedirect).toBe(true);
    expect(link.usesAffiliateLink).toBe(true);
  });

  it('falls back to a safe direct retailer URL when no affiliate mapping exists', () => {
    const link = resolveRetailerLink(
      {
        id: 'anker-solix-400',
        brand: 'Anker SOLIX',
        storeUrl: 'https://www.anker.com/uk/products/example',
      },
      { referralConfig, campaign: 'results-primary' }
    );

    expect(link).toMatchObject({
      url: 'https://www.anker.com/uk/products/example',
      usesAffiliateLink: false,
      partnerId: 'anker',
      partnerName: 'Anker SOLIX',
      label: 'View Anker store',
    });
  });

  it('rejects unknown or unsafe URLs', () => {
    expect(resolveRetailerLink('javascript:alert(1)').url).toBe('');
    expect(resolveRetailerLink('https://unknown.example')).toMatchObject({
      url: '',
      usesAffiliateLink: false,
    });
  });
});

describe('buildReferralRedirectUrl', () => {
  it('encodes kit id and campaign into a safe redirect URL', () => {
    expect(buildReferralRedirectUrl('https://wattpatch.co.uk/r/', 'ecoflow powerstream/400', 'email launch')).toBe(
      'https://wattpatch.co.uk/r/ecoflow%20powerstream%2F400?campaign=email+launch'
    );
  });

  it('returns an empty string when the redirect base is not HTTPS', () => {
    expect(buildReferralRedirectUrl('/r', 'ecoflow-powerstream-400', 'results-primary')).toBe('');
    expect(buildReferralRedirectUrl('http://wattpatch.co.uk/r', 'ecoflow-powerstream-400', 'results-primary')).toBe('');
  });
});
