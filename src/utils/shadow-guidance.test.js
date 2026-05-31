import { describe, expect, it } from 'vitest';
import { getShadowGuidance } from './shadow-guidance.js';

describe('shadow guidance copy', () => {
  it('summarises strong sunlight in homeowner-friendly language', () => {
    const guidance = getShadowGuidance({
      id: 'roof-1',
      name: 'House roof',
      avgDailyHours: 5.2,
      shadowFactor: 0.82,
      warningLevel: 'low',
    });

    expect(guidance.level).toBe('low');
    expect(guidance.title).toBe('Good sunlight');
    expect(guidance.summary).toContain('suitable for plug-in solar');
  });

  it('warns without blocking when shade risk is moderate', () => {
    const guidance = getShadowGuidance({
      id: 'wall-1',
      name: 'Outside wall',
      avgDailyHours: 4,
      shadowFactor: 0.68,
      warningLevel: 'medium',
    });

    expect(guidance.level).toBe('medium');
    expect(guidance.title).toBe('Some shade risk');
    expect(guidance.action.toLowerCase()).toContain('continue');
  });

  it('suggests trying the recommended spot when the selected spot has high shade risk', () => {
    const guidance = getShadowGuidance(
      {
        id: 'garden-1',
        name: 'Garden spot',
        avgDailyHours: 2.4,
        shadowFactor: 0.42,
        warningLevel: 'high',
      },
      {
        id: 'roof-1',
        name: 'House roof',
      },
    );

    expect(guidance.level).toBe('high');
    expect(guidance.title).toBe('High shade risk');
    expect(guidance.action).toContain('House roof');
  });
});
