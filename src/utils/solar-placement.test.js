import { describe, expect, it } from 'vitest';
import {
  getAnnualSolarRecommendation,
  getRecommendedSolarFacing,
  getRecommendedSolarTilt,
} from './solar-placement.js';

describe('solar placement recommendations', () => {
  it('targets the equator-facing direction for each hemisphere', () => {
    expect(getRecommendedSolarFacing(52.4)).toBe(180);
    expect(getRecommendedSolarFacing(-33.9)).toBe(0);
  });

  it('derives a sensible annual tilt from latitude', () => {
    expect(getRecommendedSolarTilt(51.5)).toBe(42);
    expect(getRecommendedSolarTilt(-33.9)).toBe(29);
  });

  it('clamps extreme values and falls back safely', () => {
    expect(getRecommendedSolarTilt(89)).toBe(50);
    expect(getRecommendedSolarTilt('')).toBe(35);
    expect(getAnnualSolarRecommendation(null)).toEqual({
      orientation: 180,
      tilt: 35,
    });
  });
});
