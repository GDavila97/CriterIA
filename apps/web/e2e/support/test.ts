import { test as base } from '@playwright/test';

import { MAIL_WEB_URL, WEB_URL } from './env.mjs';

/** Each test looks like a different client to Better Auth's per-IP limits, as behind a proxy. */
export function fakeClientIp(): string {
  const byte = () => Math.floor(Math.random() * 250) + 1;
  return `10.${byte()}.${byte()}.${byte()}`;
}

export const test = base.extend<{ clientIp: string }>({
  clientIp: [
    async ({ page }, use) => {
      const ip = fakeClientIp();
      for (const origin of [WEB_URL, MAIL_WEB_URL]) {
        await page.route(`${origin}/api/auth/**`, (route) =>
          route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
        );
      }
      await use(ip);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
