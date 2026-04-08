import { defineConfig } from 'vite';

export default defineConfig({
  build: {
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
