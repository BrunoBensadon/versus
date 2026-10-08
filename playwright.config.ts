import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (spec §11): a phone-sized Chromium (Pixel 7 profile) against `wrangler dev`
// with a fresh local D1 and a fake IGDB/Steam on :8788. Nothing here touches the real APIs.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:8787', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npx tsx tests/e2e/fake-upstream-server.ts',
      port: 8788,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run e2e:server',
      url: 'http://127.0.0.1:8787/',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { WRANGLER_SEND_METRICS: 'false' }, // wrangler sends no telemetry during e2e
    },
  ],
});
