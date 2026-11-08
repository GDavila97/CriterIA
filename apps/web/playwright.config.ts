import { defineConfig, devices } from '@playwright/test';

import {
  API_DIR,
  API_URL,
  apiEnv,
  GITHUB_STUB_URL,
  MAIL_WEB_URL,
  mailWebEnv,
  PORTS,
  WEB_URL,
  webEnv,
} from './e2e/support/env.mjs';

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const mobile390 = {
  browserName: 'chromium' as const,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const screens = /screens\/.*\.spec\.ts/;
const reuse = !process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'flujos', testMatch: /flows\/.*\.spec\.ts/, use: { ...desktop, colorScheme: 'light' } },
    {
      name: 'correo',
      testMatch: /mail\/.*\.spec\.ts/,
      use: { ...desktop, colorScheme: 'light', baseURL: MAIL_WEB_URL },
    },
    { name: 'desktop-light', testMatch: screens, use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', testMatch: screens, use: { ...desktop, colorScheme: 'dark' } },
    { name: 'mobile-390-light', testMatch: screens, use: { ...mobile390, colorScheme: 'light' } },
    { name: 'mobile-390-dark', testMatch: screens, use: { ...mobile390, colorScheme: 'dark' } },
  ],
  webServer: [
    {
      command: 'node e2e/support/github-stub.mjs',
      url: `${GITHUB_STUB_URL}/health`,
      reuseExistingServer: reuse,
    },
    {
      command: 'uv run --no-sync criteria-api',
      cwd: API_DIR,
      url: `${API_URL}/healthz`,
      env: { ...apiEnv, VIRTUAL_ENV: '' },
      reuseExistingServer: reuse,
      timeout: 120_000,
    },
    {
      command: `pnpm start --hostname 127.0.0.1 --port ${PORTS.web}`,
      url: WEB_URL,
      env: webEnv,
      reuseExistingServer: reuse,
    },
    {
      command: `pnpm start --hostname 127.0.0.1 --port ${PORTS.mailWeb}`,
      url: MAIL_WEB_URL,
      env: mailWebEnv,
      reuseExistingServer: reuse,
    },
  ],
});
