import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    cspViolations: string[];
  }
}

/** Violations from the DOM event and from the console, plus uncaught errors. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.cspViolations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
});

for (const path of ['/', '/privacidad']) {
  test(`${path} loads without CSP violations or errors`, async ({ page }) => {
    const problems = watchProblems(page);

    await page.goto(path);
    await page.waitForLoadState('networkidle');

    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('the evaluation board reads the API through the CSP and CORS', async ({ page }) => {
  const problems = watchProblems(page);

  await page.goto('/evaluacion');
  const table = page.getByRole('region', { name: 'Tabla de comparación por modelo' });

  await expect(table.getByRole('row').nth(2)).toBeVisible();
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(problems).toEqual([]);
});
