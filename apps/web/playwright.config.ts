import { defineConfig, devices } from '@playwright/test'

// E2E_PORT lets two checkouts run e2e side by side; each needs its own preview server.
const PORT = Number(process.env.E2E_PORT ?? 4173)
const baseURL = `http://localhost:${PORT}`
const ci = !!process.env.CI

// Everyone in the journeys lives in UTC, so plan grids and dates read the same on every machine.
const shared = {
  baseURL,
  locale: 'en-US',
  timezoneId: 'UTC',
  // The PWA service worker caches the shell; tests want the network every time.
  serviceWorkers: 'block' as const,
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : Number(process.env.E2E_WORKERS ?? 2),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...shared,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        ...shared,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...shared,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 14'],
        ...shared,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    // Same as CI: a production build served by `vite preview`.
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: { VITE_APP_URL: baseURL },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
