import { describe, expect, it } from 'vitest';
import { ALLOWED_RETAILER_HOSTS, resolveRetailerLink } from './referrals.js';

describe('retailer referral links', () => {
  it('allows known kit retailer hosts and returns a safe direct link by default', () => {
    const link = resolveRetailerLink('https://uk.ecoflow.com/products/example');

    expect(ALLOWED_RETAILER_HOSTS).toContain('uk.ecoflow.com');
    expect(link).toMatchObject({
      url: 'https://uk.ecoflow.com/products/example',
      usesAffiliateLink: false,
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
