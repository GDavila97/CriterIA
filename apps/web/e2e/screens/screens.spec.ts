import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, TestInfo } from '@playwright/test';

import {
  expectNoAxeViolations,
  finishRun,
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
async function check(page: Page, testInfo: TestInfo, name: string, fullPage = true): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(SHOTS, `${name}-${testInfo.project.name}.png`),
      fullPage,
    });
  }
}

async function signIn(page: Page, request: Page['request'], baseURL: string, ip: string) {
  await signUpByApi(request, baseURL, ip);
  await page.goto('/corrida');
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
  await check(page, testInfo, '02-corrida-nueva');
  await startRun(page);
  await waitForApproval(page);
  await check(page, testInfo, '03-pausa-humana');
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);
  await page.getByRole('tab', { name: 'Casos de prueba' }).click();
  await check(page, testInfo, '04-corrida-terminada');
  await page.getByRole('button', { name: 'Ver agente Revisor' }).click();
  await expect(page.getByRole('dialog', { name: 'Agente' })).toBeVisible();
  await check(page, testInfo, '05-panel-agente', false);
});

test('aviso de clave sin saldo', async ({ page, baseURL, clientIp }, testInfo) => {
  await signIn(page, page.request, baseURL ?? '', clientIp);
  await page.goto('/ajustes/modelos');
  const openai = page.getByRole('region', { name: 'OpenAI', exact: true });
  await openai.getByLabel('Clave de API de OpenAI').fill('sk-nosaldo-9999');
  await openai.getByRole('button', { name: 'Guardar y validar' }).click();
  await expect(openai.getByText('••••9999')).toBeVisible();
  await check(page, testInfo, '06-modelos-y-claves');
  await startRun(page, { generation: 'OpenAI · Económico (gpt-6-luna)' });
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
  await expect(
    page.getByText('Los resultados se publicarán tras la primera evaluación.'),
  ).toBeVisible();
  await check(page, testInfo, '08-evaluacion');
  await signIn(page, page.request, baseURL ?? '', clientIp);
  await page.goto('/historial');
  await expect(page.getByText('Aún no tienes corridas guardadas.')).toBeVisible();
  await check(page, testInfo, '09-historial');
  await page.goto('/privacidad');
  await check(page, testInfo, '10-privacidad');
  await page.goto('/ajustes/cuenta');
  await check(page, testInfo, '11-cuenta');
  await page.goto('/ajustes/historial');
  await check(page, testInfo, '12-ajustes-historial');
});
