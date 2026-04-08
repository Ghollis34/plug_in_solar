import { describe, expect, it } from 'vitest';
import { escapeHtml, sanitizeExternalUrl } from './security.js';

describe('security utils', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<img src=x onerror='alert(1)'>`)).toBe('&lt;img src=x onerror=&#39;alert(1)&#39;&gt;');
  });

  it('rejects non-https external urls', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeExternalUrl('http://example.com')).toBeNull();
  });

  it('enforces allowed host lists', () => {
    expect(
      sanitizeExternalUrl('https://uk.ecoflow.com/products/test', {
        allowedHosts: ['uk.ecoflow.com', 'zendure.com'],
      })
    ).toBe('https://uk.ecoflow.com/products/test');

    expect(
      sanitizeExternalUrl('https://evil.example.com', {
        allowedHosts: ['uk.ecoflow.com', 'zendure.com'],
      })
    ).toBeNull();
  });

  it('allows subdomains for allowed hosts', () => {
    expect(
      sanitizeExternalUrl('https://shop.zendure.com/products/test', {
        allowedHosts: ['zendure.com'],
      })
    ).toBe('https://shop.zendure.com/products/test');
  });
});
