import { describe, expect, it } from 'vitest';
import {
  normalizeLocation,
  normalizeObstacle,
  normalizeAnnualUsageKwh,
  normalizeElectricityPricePence,
  normalizePersistedState,
  normalizeSelectedKit,
  normalizeSpace,
  reconcileDerivedState,
} from './state-normalizers.js';

describe('state normalizers', () => {
  it('sanitizes location text and bounds coordinates', () => {
    expect(normalizeLocation({
      lat: 91,
      lng: -181,
      displayName: '  10 Downing St\u0000<script> ',
      postcode: ' SW1A 2AA ',
      city: ' Westminster ',
      county: ' Greater London ',
      stateDistrict: ' London ',
      country: ' United Kingdom ',
    })).toEqual({
      lat: 90,
      lng: -180,
      displayName: '10 Downing St<script>',
      postcode: 'SW1A 2AA',
      city: 'Westminster',
      county: 'Greater London',
      stateDistrict: 'London',
      country: 'United Kingdom',
    });
  });

  it('normalizes spaces against allowlists and clamps numeric fields', () => {
    const normalized = normalizeSpace({
      id: 'space-1',
      name: '  <strong>Wall spot</strong>  ',
      type: 'not-real',
      centerLat: 51.5,
      centerLng: -0.1,
      orientation: 725,
      displayRotation: -10,
      tilt: 120,
      avgDailyHours: 42,
      shadowFactor: 4,
      warnings: ['  <script>alert(1)</script>  '],
      warningLevel: 'critical',
      confidence: 'very-high',
      mountHostType: 'shed',
      mountHostId: 'shed-1',
      mountHeightM: 120,
    });

    expect(normalized.type).toBe('ground');
    expect(normalized.typeIcon).toBe('🌿');
    expect(normalized.tilt).toBe(90);
    expect(normalized.orientation).toBe(359);
    expect(normalized.displayRotation).toBe(0);
    expect(normalized.avgDailyHours).toBe(24);
    expect(normalized.shadowFactor).toBe(1);
    expect(normalized.warnings).toEqual(['<script>alert(1)</script>']);
    expect(normalized.warningLevel).toBe('low');
    expect(normalized.confidence).toBe('medium');
    expect(normalized.mountHostType).toBe('shed');
    expect(normalized.mountHostId).toBe('shed-1');
    expect(normalized.mountHeightM).toBe(80);
  });

  it('rejects malformed obstacles and clamps valid obstacle dimensions', () => {
    expect(normalizeObstacle({ id: 'oops', type: 'hedge' })).toBeNull();

    expect(normalizeObstacle({
      id: 'shed-1',
      type: 'shed',
      lat: 51.5,
      lng: -0.1,
      widthM: 1000,
      depthM: 0.1,
      heightM: 30,
      rotationDeg: 721,
    })).toMatchObject({
      id: 'shed-1',
      type: 'shed',
      widthM: 60,
      depthM: 0.5,
      heightM: 20,
      rotationDeg: 359,
    });
  });

  it('persists selected kits as id references only', () => {
    expect(normalizeSelectedKit({
      id: 'kit-1',
      name: 'Injected',
      storeUrl: 'https://evil.example.com',
    })).toEqual({ id: 'kit-1' });
  });

  it('allows blank annual usage and clamps custom values', () => {
    expect(normalizeAnnualUsageKwh('')).toBeNull();
    expect(normalizeAnnualUsageKwh(42)).toBe(100);
    expect(normalizeAnnualUsageKwh(3200)).toBe(3200);
  });

  it('allows blank electricity price and clamps custom values', () => {
    expect(normalizeElectricityPricePence('')).toBeNull();
    expect(normalizeElectricityPricePence(0.2)).toBe(1);
    expect(normalizeElectricityPricePence(24.678)).toBe(24.68);
  });

  it('reconciles invalid selected space and stale analysis', () => {
    const defaultState = {
      currentStep: 0,
      maxVisitedStep: 0,
      location: null,
      buildings: [],
      spaces: [],
      selectedSpaceId: null,
      obstacles: [],
      sunAnalysis: null,
      annualUsageKwh: null,
      electricityPricePence: null,
      selectedKit: null,
      results: null,
    };

    const normalized = normalizePersistedState({
      currentStep: 9,
      maxVisitedStep: 99,
      spaces: [
        {
          id: 'space-a',
          type: 'wall',
          centerLat: 51.5,
          centerLng: -0.1,
        },
      ],
      selectedSpaceId: 'missing-space',
      sunAnalysis: {
        bestSpaceId: 'missing-space',
        scores: [
          {
            id: 'missing-space',
            type: 'wall',
            centerLat: 51.5,
            centerLng: -0.1,
          },
        ],
      },
    }, defaultState);

    reconcileDerivedState(normalized, normalized, defaultState);

    expect(normalized.currentStep).toBe(6);
    expect(normalized.maxVisitedStep).toBe(6);
    expect(normalized.selectedSpaceId).toBeNull();
    expect(normalized.sunAnalysis).toBeNull();
  });
});
