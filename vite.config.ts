import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Commit Trail',
        short_name: 'Commit Trail',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#070a11',
        background_color: '#070a11',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png}'],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        inlineWorkboxRuntime: true,
        navigateFallback: 'index.html',
        // Only the app root, including repo/debug queries. The cached key stays index.html.
        navigateFallbackAllowlist: [/^\/(?:\?.*)?$/],
        // No runtime routes: GitHub/API/auth responses always use the ordinary network.
        runtimeCaching: [],
      },
    }),
  ],
});
