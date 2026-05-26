import { describe, expect, it } from 'vitest';
import { getPanelMarkerVisualSize } from './map-helpers.js';

describe('getPanelMarkerVisualSize', () => {
  it('shrinks the visible panel marker when the map is zoomed out', () => {
    const close = getPanelMarkerVisualSize({ zoom: 20, lat: 52 });
    const far = getPanelMarkerVisualSize({ zoom: 16, lat: 52 });

    expect(far.widthPx).toBeLessThan(close.widthPx);
    expect(far.heightPx).toBeLessThan(close.heightPx);
  });

  it('keeps a standard solar panel aspect ratio while scaling', () => {
    const marker = getPanelMarkerVisualSize({ zoom: 19.5, lat: 52 });

    expect(marker.widthPx / marker.heightPx).toBeCloseTo(1.76 / 1.13, 1);
  });

  it('clamps the visual footprint so the marker stays usable at extreme zooms', () => {
    const far = getPanelMarkerVisualSize({ zoom: 4, lat: 52 });
    const close = getPanelMarkerVisualSize({ zoom: 22, lat: 52 });

    expect(far.widthPx).toBeGreaterThanOrEqual(6);
    expect(close.widthPx).toBeLessThanOrEqual(44);
  });
});
