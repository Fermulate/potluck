/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { appVersion } from './app-version.ts'
import { ocrAssets } from './ocr-assets.ts'
import { prerenderLanding } from './prerender-landing.ts'
import { requireEnv } from './require-env.ts'
import { routePreloads } from './route-preloads.ts'

// .env files live at the repo root
const envDir = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  envDir,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    requireEnv(mode, loadEnv(mode, envDir, 'VITE_')),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    routePreloads(loadEnv(mode, envDir, 'VITE_').VITE_SUPABASE_URL),
    prerenderLanding(),
    ocrAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      // Deferred so the registration script never blocks the first paint.
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Push and notification click handlers live in a plain script next to the app.
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        // App code plus the latin faces every screen uses, so an installed app renders offline
        // in its own type. The design kit route is not linked from the app.
        globPatterns: [
          '**/*.{js,css,html}',
          'assets/*-latin-opsz-*.woff2',
          'assets/*-latin-400-*.woff2',
        ],
        // The receipt reader is megabytes most people never use: it is cached the first time
        // someone scans (below), not installed with the app.
        globIgnores: ['**/dev.kit-*.js', 'ocr/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'potluck-ocr',
              expiration: { maxEntries: 12 },
            },
          },
        ],
      },
      manifest: {
        id: '/',
        name: 'Potluck',
        short_name: 'Potluck',
        description: 'Split expenses and plan group events.',
        theme_color: '#1d1a16',
        background_color: '#fbf5ea',
        display: 'standalone',
        start_url: '/home',
        scope: '/',
        categories: ['finance', 'lifestyle', 'social'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          {
            name: 'Add expense',
            url: '/new/expense',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Plan something',
            url: '/new/plan',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Room for a few slow findBy waits (see src/test/setup.ts) before a test is called hung.
    testTimeout: 20_000,
    css: false,
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/**/fake-supabase.ts',
        'src/**/*test-utils.ts',
        // file routes are thin wrappers, covered by the Playwright journeys
        'src/routes/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      thresholds: { statements: 70, branches: 75, functions: 85, lines: 70 },
    },
  },
}))
