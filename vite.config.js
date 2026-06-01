import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Keep previous hashed chunks on the VPS so a phone with a cached app shell can
    // still load a lazy step after a new deploy. Periodic cleanup can prune old
    // assets later, but deleting every chunk during deploy causes dynamic imports
    // to fail for live mobile testers.
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return null;
          }

          if (id.includes('node_modules/maplibre-gl')) {
            return 'vendor-maplibre';
          }

          if (id.includes('node_modules/chart.js')) {
            return 'vendor-charts';
          }

          if (id.includes('node_modules/suncalc')) {
            return 'vendor-suncalc';
          }

          return 'vendor';
        },
      },
    },
  },
});
