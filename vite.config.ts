import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` keeps every asset URL relative, so the same build works at a
// domain root, in a sub-folder (e.g. GitHub Pages) or wrapped in a desktop shell.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from main.tsx, and only on the web: the Android app ships its files already.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Earth Vision — World Builder',
        short_name: 'Earth Vision',
        description: 'Build and reshape your own world: countries, regions, flags and cities on a 3D globe.',
        theme_color: '#1d2433',
        background_color: '#dfeef8',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Everything the map needs ships with the app, so it works fully offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webp,pbf,json,ico,webmanifest,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Big, rarely-changing libraries get their own files so app updates don't re-download them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (/[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
