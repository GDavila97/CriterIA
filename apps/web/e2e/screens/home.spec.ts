import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    cspViolations: string[];
  }
}

function collectCspViolations(page: Page): string[] {
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) {
      consoleViolations.push(message.text());
    }
  });
  return consoleViolations;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.cspViolations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
});

test('home shows the product name and logo', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'CriterIA' })).toBeVisible();
  await expect(page.getByTestId('ficha')).toBeVisible();
});

test('home has no accessibility violations', async ({ page }) => {
  await page.goto('/');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('home loads without Content Security Policy violations', async ({ page }) => {
  const consoleViolations = collectCspViolations(page);

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(consoleViolations).toEqual([]);
});

test('home sends a nonce-based CSP and the base security headers', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  const csp = headers['content-security-policy'] ?? '';
  const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src ')) ?? '';

  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scriptSrc).not.toContain('unsafe-inline');
  expect(scriptSrc).not.toContain('unsafe-eval');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['x-powered-by']).toBeUndefined();
});
