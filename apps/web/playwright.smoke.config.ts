import { defineConfig, devices } from '@playwright/test';

// Only for scripts/smoke-prod.sh against a deployed web; `pnpm e2e` never loads this file.
const baseURL = process.env.SMOKE_WEB_URL;
if (!baseURL) {
  throw new Error('SMOKE_WEB_URL is required');
}

export default defineConfig({
  testDir: 'smoke',
  testMatch: /\.smoke\.ts$/,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: { baseURL, trace: 'off' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'movil-390',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
});
