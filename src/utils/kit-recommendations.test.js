import { describe, expect, it } from 'vitest';
import { splitRecommendedKits } from './kit-recommendations.js';

describe('kit recommendation display', () => {
  const kits = Array.from({ length: 6 }, (_, index) => ({ id: `kit-${index + 1}` }));

  it('shows only the top three kits first and hides the rest behind show more', () => {
    const result = splitRecommendedKits(kits, { showAll: false });

    expect(result.recommended.map((kit) => kit.id)).toEqual(['kit-1', 'kit-2', 'kit-3']);
    expect(result.extra.map((kit) => kit.id)).toEqual([]);
    expect(result.hiddenCount).toBe(3);
    expect(result.isLimited).toBe(true);
  });

  it('returns all kits once the user asks to compare more options', () => {
    const result = splitRecommendedKits(kits, { showAll: true });

    expect(result.recommended.map((kit) => kit.id)).toEqual(['kit-1', 'kit-2', 'kit-3']);
    expect(result.extra.map((kit) => kit.id)).toEqual(['kit-4', 'kit-5', 'kit-6']);
    expect(result.hiddenCount).toBe(0);
    expect(result.isLimited).toBe(false);
  });
});
