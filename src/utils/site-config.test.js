import { describe, expect, it } from 'vitest';
import { getSpaceTypeInfo, SPACE_TYPES } from './site-config.js';

describe('site configuration copy', () => {
  it('explains each panel placement option in homeowner-friendly language', () => {
    expect(SPACE_TYPES).toHaveLength(5);

    for (const type of SPACE_TYPES) {
      expect(type.description).toEqual(expect.any(String));
      expect(type.description.length).toBeGreaterThan(35);
      expect(type.actionLabel).toEqual(expect.any(String));
      expect(type.actionLabel).not.toMatch(/mount spot/i);
    }

    expect(getSpaceTypeInfo('wall').label).toBe('Outside wall');
    expect(getSpaceTypeInfo('railing').description).toMatch(/flat|balcony|railing/i);
    expect(getSpaceTypeInfo('ground').description).toMatch(/garden|patio/i);
  });
});
