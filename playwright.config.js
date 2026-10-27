import { defineConfig, devices } from '@playwright/test';

/**
 * Port for the test server. Deliberately not 4173 (the `npm run preview`
 * default), so the tests never collide with a preview you have open.
 */
const PORT = 4183;

/**
 * Browser tests run against the production build served by `vite preview`,
 * so they exercise the bundled worker paths and the same Content-Security-Policy
 * that Cloudflare Pages serves (see public/_headers). WebKit covers Safari's
 * path, where images are processed on the page instead of in a worker.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
