import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, TestInfo } from '@playwright/test';

import {
  expectNoAxeViolations,
  finishRun,
  LONG_REQUIREMENT,
  signUpByApi,
  startRun,
  waitForApproval,
} from '../support/helpers';
import { expect, test } from '../support/test';

declare global {
  interface Window {
    cspViolations: string[];
  }
}

const SHOTS = process.env.SCREENSHOT_DIR;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.cspViolations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
});

/** axe and the CSP on what is on screen, plus the evidence screenshot when asked for. */
async function check(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = true,
  { idle = true }: { idle?: boolean } = {},
): Promise<void> {
  // A request the test holds open on purpose never lets the network go idle.
  if (idle) await page.waitForLoadState('networkidle');
  await settleAnimations(page);
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(SHOTS, `${name}-${testInfo.project.name}.png`),
      fullPage,
      // A full-page capture in Chromium restarts CSS entrances; this shows them finished.
      animations: 'disabled',
    });
  }
}

/** Entrances fade in; axe would measure contrast halfway through them. Loops are left alone. */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 400) return;
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.page, 'la página no se desborda a lo ancho').toBeLessThanOrEqual(widths.viewport);
}

async function signIn(page: Page, request: Page['request'], baseURL: string, ip: string) {
  await signUpByApi(request, baseURL, ip);
  await page.goto('/analisis');
}

test('inicio y registro', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, testInfo, '01-inicio');
});

test('vista clásica: pausa humana, corrida terminada y panel del agente', async ({
  page,
  baseURL,
  clientIp,
}, testInfo) => {
  await signIn(page, page.request, baseURL ?? '', clientIp);
  await check(page, testInfo, '02-analisis-nuevo');
  await startRun(page);
  await waitForApproval(page);
  await check(page, testInfo, '03-pausa-humana');
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);
  await page.getByRole('tab', { name: 'Casos de prueba' }).click();
  await check(page, testInfo, '04-analisis-terminado');
  await page.getByRole('button', { name: 'Ver agente Revisor' }).click();
  await expect(page.getByRole('dialog', { name: 'Agente' })).toBeVisible();
  await check(page, testInfo, '05-panel-agente', false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Agente' })).toBeHidden();
  await page.getByRole('button', { name: /^Ejecutar/ }).click();
  await expect(page.getByRole('alertdialog', { name: '¿Descartar el análisis?' })).toBeVisible();
  await check(page, testInfo, '15-aviso-sin-guardar', false);
});

test('corrida larga: artefactos paginados y registro completo', async ({
  page,
  baseURL,
  clientIp,
}, testInfo) => {
  await signIn(page, page.request, baseURL ?? '', clientIp);
  await startRun(page, { requirement: LONG_REQUIREMENT });
  await waitForApproval(page);
  await page.getByRole('button', { name: /^Aprobar 12 historias/ }).click();
  await finishRun(page);
  const card = page.getByRole('region', { name: 'Artefactos' });
  await card.getByRole('tab', { name: 'Casos de prueba' }).click();
  await card
    .getByRole('navigation', { name: 'Páginas de casos de prueba' })
    .getByRole('button', { name: 'Siguiente' })
    .click();
  await check(page, testInfo, '13-paginacion');
  await page.getByRole('button', { name: /^Ver registro completo/ }).click();
  await expect(page.getByRole('dialog', { name: 'Registro completo' })).toBeVisible();
  await check(page, testInfo, '14-registro-completo', false);
});

test('aviso de clave sin saldo', async ({ page, baseURL, clientIp }, testInfo) => {
  await signIn(page, page.request, baseURL ?? '', clientIp);
  await page.goto('/ajustes/modelos');
  const openai = page.getByRole('region', { name: 'OpenAI', exact: true });
  await openai.getByLabel('Clave de API de OpenAI').fill('sk-nosaldo-9999');
  await openai.getByRole('button', { name: 'Guardar y validar' }).click();
  await expect(openai.getByText('••••9999')).toBeVisible();
  await check(page, testInfo, '06-modelos-y-claves');
  await startRun(page, { generation: 'OpenAI · Económico' });
  await expect(
    page.getByRole('heading', { name: 'Tu clave de OpenAI no tiene saldo' }),
  ).toBeVisible();
  await check(page, testInfo, '07-aviso-sin-saldo');
});

test('evaluación, historial, privacidad y cuenta', async ({
  page,
  baseURL,
  clientIp,
}, testInfo) => {
  await page.goto('/evaluacion');
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(5);
  await expect(table.getByText('Anthropic · Claude Haiku 5.5 *')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Acuerdo del juez con una persona' }),
  ).toBeVisible();
  await expect(page.getByText(/32 pares criterio por análisis/)).toBeVisible();
  await expect(page.getByText(/El juez es consistente pero no está validado/)).toBeVisible();
  await check(page, testInfo, '08-evaluacion');
  await signIn(page, page.request, baseURL ?? '', clientIp);
  await page.goto('/historial');
  await expect(page.getByText('Aún no tienes análisis guardados.')).toBeVisible();
  await check(page, testInfo, '09-historial');
  await page.goto('/privacidad');
  await check(page, testInfo, '10-privacidad');
  await page.goto('/ajustes/cuenta');
  await check(page, testInfo, '11-cuenta');
  await page.goto('/ajustes/historial');
  await check(page, testInfo, '12-ajustes-historial');
});

test('vista oficina: durante, tu turno y al terminar', async ({
  page,
  baseURL,
  clientIp,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, 'a 390 px la oficina no se ofrece; la otra prueba cubre esa caída');
  await signUpByApi(page.request, baseURL ?? '', clientIp);
  await page.goto('/analisis?vista=oficina');
  const office = page.getByRole('region', { name: 'Oficina' });
  await expect(office).toBeVisible();
  await check(page, testInfo, '16-oficina-inactiva');

  await startRun(page, { vista: 'oficina' });
  await expect(office.getByText('Redactando historias')).toBeVisible();
  await check(page, testInfo, '17-oficina-durante');
  await expect(office.getByRole('button', { name: 'Revisar historias' })).toBeVisible();
  await check(page, testInfo, '18-oficina-tu-turno');
  await office.getByRole('button', { name: 'Revisar historias' }).click();
  await expect(page.getByRole('dialog', { name: 'Revisar historias' })).toBeVisible();
  await check(page, testInfo, '19-oficina-revisar-historias', false);
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await expect(office.getByText('Análisis listo')).toBeVisible();
  await check(page, testInfo, '20-oficina-al-terminar');
});

test('a 390 px la oficina cae a la vista clásica', async ({
  page,
  baseURL,
  clientIp,
  isMobile,
}) => {
  test.skip(!isMobile, 'solo aplica a 390 px');
  await signUpByApi(page.request, baseURL ?? '', clientIp);
  await page.goto('/analisis?vista=oficina');
  await expect(page.getByRole('region', { name: 'Flujo de agentes' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Vista' })).toBeHidden();
});

test('capa de espera y diálogo de límite', async ({ page, baseURL, clientIp }, testInfo) => {
  await signIn(page, page.request, baseURL ?? '', clientIp);
  let release: () => void = () => {};
  const answered = new Promise<void>((resolve) => (release = resolve));
  let posts = 0;
  await page.route('**/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    if (posts === 1) {
      await answered;
      return route.continue();
    }
    if (posts === 2) return route.abort('internetdisconnected');
    return route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 'limite_hora', message: 'Alcanzaste el límite.' }),
    });
  });

  await startRun(page);
  const layer = page.getByRole('status').filter({ hasText: 'Estamos preparando todo' });
  await expect(layer).toBeVisible();
  await check(page, testInfo, '21-espera-preparando', false, { idle: false });
  release();
  await waitForApproval(page);

  await page.getByRole('button', { name: /^Ejecutar/ }).click();
  await page
    .getByRole('alertdialog', { name: '¿Descartar el análisis?' })
    .getByRole('button', { name: 'Descartar y continuar' })
    .click();
  const failed = page.getByRole('status').filter({ hasText: 'No logramos conectar' });
  await expect(failed.getByRole('button', { name: 'Reintentar' })).toBeFocused();
  await check(page, testInfo, '22-espera-sin-conexion', false);
  await failed.getByRole('button', { name: 'Cancelar' }).click();

  // The paused analysis is still the one on screen, so starting another asks again.
  await page.getByRole('button', { name: /^Ejecutar/ }).click();
  await page
    .getByRole('alertdialog', { name: '¿Descartar el análisis?' })
    .getByRole('button', { name: 'Descartar y continuar' })
    .click();
  const limit = page.getByRole('alertdialog', {
    name: 'Alcanzaste el límite de análisis por hora',
  });
  await expect(limit).toBeVisible();
  await check(page, testInfo, '23-limite', false);
});

test('con movimiento reducido nada se desplaza, solo se funde', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const distances = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ['--motion-shift', '--motion-lift', '--motion-slide'].map((name) =>
      root.getPropertyValue(name).trim(),
    );
  });
  expect(distances).toEqual(['0px', '0px', '0px']);
});

test('la tabla de evaluación cabe completa a 1280 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a 390 px la tabla se desplaza dentro de su caja');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/evaluacion');
  const box = page.getByRole('region', { name: 'Tabla de comparación por modelo' });
  await expect(box.getByText('Anthropic · Claude Haiku 5.5 *')).toBeVisible();

  const widths = await box.evaluate((element) => ({
    content: element.scrollWidth,
    visible: element.clientWidth,
  }));

  expect(widths.content, 'la tabla no se desborda dentro de su caja').toBeLessThanOrEqual(
    widths.visible,
  );
});
