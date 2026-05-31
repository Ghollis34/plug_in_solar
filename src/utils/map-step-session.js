import { loadMapRuntime } from './map-runtime.js';

export function createMapStepSession() {
  let activeToken = 0;
  let runtime = null;
  let map = null;

  function beginRun() {
    activeToken += 1;
    return activeToken;
  }

  function isCurrent(token) {
    return token === activeToken;
  }

  async function ensureRuntime(token) {
    if (!runtime) {
      runtime = await loadMapRuntime();
    }

    return isCurrent(token) ? runtime : null;
  }

  function getRuntime() {
    return runtime;
  }

  function getMap() {
    return map;
  }

  function removeMap() {
    if (!map) return;

    map.remove();
    map = null;
  }

  function destroy() {
    activeToken += 1;
    removeMap();
  }

  function createMap(token, options = {}) {
    if (!runtime?.createStepMap) {
      return Promise.reject(new Error('Map runtime must be loaded before creating a map.'));
    }

    removeMap();

    return new Promise((resolve, reject) => {
      let settled = false;
      const handleLoad = options.onLoad;

      const finish = (value, isError = false) => {
        if (settled) return;
        settled = true;
        if (isError) reject(value);
        else resolve(value);
      };

      const handleRemove = () => {
        finish(null);
      };

      try {
        map = runtime.createStepMap({
          ...options,
          onLoad: (loadedMap) => {
            requestAnimationFrame(() => loadedMap?.resize?.());
            Promise.resolve()
              .then(() => handleLoad?.(loadedMap))
              .then(() => {
                loadedMap?.off?.('remove', handleRemove);
                finish(isCurrent(token) ? loadedMap : null);
              })
              .catch((error) => {
                loadedMap?.off?.('remove', handleRemove);
                finish(error, true);
              });
          },
        });
      } catch (error) {
        finish(error, true);
        return;
      }

      map?.on?.('remove', handleRemove);
    });
  }

  return {
    beginRun,
    createMap,
    destroy,
    ensureRuntime,
    getMap,
    getRuntime,
    isCurrent,
  };
}
