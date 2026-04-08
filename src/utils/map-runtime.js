let mapRuntimePromise = null;

export function loadMapRuntime() {
  if (!mapRuntimePromise) {
    mapRuntimePromise = Promise.all([
      import('maplibre-gl'),
      import('./map-helpers.js'),
    ]).then(([maplibreModule, helpers]) => ({
      maplibregl: maplibreModule.default || maplibreModule,
      ...helpers,
    }));
  }

  return mapRuntimePromise;
}
