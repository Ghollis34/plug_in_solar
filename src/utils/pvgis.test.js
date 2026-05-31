import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPVGISRequestUrl, fetchSolarData } from './pvgis.js';

describe('PVGIS solar data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks successful PVGIS responses with display-safe source metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        outputs: {
          monthly: {
            fixed: Array.from({ length: 12 }, (_, index) => ({
              month: index + 1,
              E_m: 50 + index,
              H_m: 60 + index,
              E_d: 1.7,
            })),
          },
          totals: {
            fixed: {
              E_y: 880.4,
              H_y: 1000.2,
              E_d: 2.41,
            },
          },
        },
      }),
    })));

    const data = await fetchSolarData(51.5011, -0.1411, 35, 0);

    expect(data.isFallback).toBe(false);
    expect(data.source).toBe('PVGIS');
    expect(data.sourceDetail).toContain('EU PVGIS');
    expect(data.annual.kwhPerKwp).toBe(880.4);
  });

  it('marks fallback data clearly when PVGIS cannot be reached from the browser', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const data = await fetchSolarData(55.9533, -3.1883, 35, 0);

    expect(data.isFallback).toBe(true);
    expect(data.source).toBe('UK fallback');
    expect(data.sourceDetail).toContain('PVGIS could not be reached');
    expect(data.annual.kwhPerKwp).toBeGreaterThan(0);
  });

  it('can route PVGIS requests through a proxy endpoint for browser CORS deployments', () => {
    const directUrl = buildPVGISRequestUrl(51.5, -0.12, 30, -10);
    const proxiedUrl = buildPVGISRequestUrl(51.5, -0.12, 30, -10, 'https://example.com/api/pvgis');

    expect(directUrl).toContain('https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?');
    expect(proxiedUrl).toContain('https://example.com/api/pvgis?target=');
    expect(decodeURIComponent(proxiedUrl.split('target=')[1])).toBe(directUrl);
  });
});
