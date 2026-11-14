import { readFile } from 'node:fs/promises';

import { expect, test } from '../support/test';

import { API_URL } from '../support/env.mjs';
import {
  finishRun,
  LONG_REQUIREMENT,
  signUpByUi,
  startRun,
  uniqueEmail,
  waitForApproval,
} from '../support/helpers';

test.beforeEach(async ({ page }) => {
  await signUpByUi(page, uniqueEmail('corrida'));
  await expect(page).toHaveURL(/\/analisis$/);
});

test('una corrida completa con la aprobación editada', async ({ page }) => {
  await startRun(page);
  await waitForApproval(page);
  await expect(page.getByText('Tú · revisando')).toBeVisible();

  await page.getByLabel('Incluir HU-3').uncheck();
  await page.getByRole('button', { name: 'Editar HU-1' }).click();
  await page.getByLabel('Quiero').fill('apartar un libro desde el celular');
  await page.getByRole('button', { name: 'Terminar edición de HU-1' }).click();
  await page.getByRole('button', { name: 'Aprobar 2 historias y continuar' }).click();

  await finishRun(page);
  await page.getByRole('button', { name: /^Ver registro completo/ }).click();
  const fullLog = page.getByRole('log', { name: 'Registro completo del análisis' });
  await expect(fullLog.getByText('Editaste las historias (1 modificada, 1 quitada)')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText(/quiero apartar un libro desde el celular/)).toBeVisible();
  await page.getByRole('tab', { name: 'Casos de prueba' }).click();
  await expect(page.getByRole('table').getByText('Revisor')).toBeVisible();
  await expect(page.getByRole('region', { name: /Rúbrica/ })).toContainText('4.0');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar' }).click();
  await page.getByRole('button', { name: 'Markdown' }).click();
  expect((await download).suggestedFilename()).toMatch(/^criteria-.*\.md$/);
});

test('el Analista escribe otra versión hasta dos veces', async ({ page }) => {
  await startRun(page);
  await waitForApproval(page);

  const notes = ['Menos historias', ''];
  for (const [index, nota] of notes.entries()) {
    await page.getByRole('button', { name: 'Pedir otra versión al Analista' }).click();
    if (nota) await page.getByLabel('¿Qué esperabas? (opcional)').fill(nota);
    await page.getByRole('button', { name: 'Enviar al Analista' }).click();
    // The full log tells when the new version arrived: one more request and one more pause.
    await page.getByRole('button', { name: /^Ver registro completo/ }).click();
    const fullLog = page.getByRole('log', { name: 'Registro completo del análisis' });
    await expect(fullLog.getByText('Pediste otra versión de las historias')).toHaveCount(index + 1);
    await expect(fullLog.getByText(/^Esperando tu revisión/)).toHaveCount(index + 2);
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await waitForApproval(page);
  }

  await expect(page.getByRole('button', { name: 'Pedir otra versión al Analista' })).toBeDisabled();
  await expect(page.getByText(/Ya pediste dos versiones nuevas en este análisis/)).toBeVisible();
  await page.getByRole('button', { name: /^Aprobar 2 historias/ }).click();
  await finishRun(page);
});

test('el stream se reconecta con Last-Event-ID tras un corte', async ({ page }) => {
  const resumedFrom: string[] = [];
  let cut = false;
  await page.route(`${API_URL}/runs/*/stream`, async (route) => {
    const lastEventId = route.request().headers()['last-event-id'];
    if (lastEventId) resumedFrom.push(lastEventId);
    if (cut) {
      await route.continue();
      return;
    }
    cut = true;
    // Deliver only the first three events and close, as a dropped connection would.
    const response = await route.fetch();
    const frames = (await response.text()).split('\n\n').filter((f) => f.startsWith('id:'));
    await route.fulfill({ response, body: `${frames.slice(0, 3).join('\n\n')}\n\n` });
  });

  await startRun(page);
  await waitForApproval(page);

  expect(resumedFrom).toEqual(['3']);
  await expect(page.getByText(/^Analista entregó \d historias$/)).toHaveCount(1);
  await expect(page.getByText('El análisis empezó')).toHaveCount(1);
});

test('una corrida larga: registro completo en vivo, artefactos paginados y exportación completa', async ({
  page,
}) => {
  const streams: string[] = [];
  page.on('request', (request) => {
    if (/\/runs\/[^/]+\/stream$/.test(request.url())) streams.push(request.url());
  });
  await startRun(page, { requirement: LONG_REQUIREMENT });
  await waitForApproval(page);
  expect(streams).toHaveLength(1);
  // Answering follows the stream again (ADR 0018); the panel must not add another one.
  const resumed = page.waitForRequest(/\/runs\/[^/]+\/stream$/);
  await page.getByRole('button', { name: 'Aprobar 12 historias y continuar' }).click();
  await resumed;

  const recent = page.getByRole('log', { name: 'Últimos eventos' });
  await expect(recent.getByRole('listitem')).toHaveCount(5);
  await page.getByRole('button', { name: /^Ver registro completo \(\d+\)$/ }).click();
  const panel = page.getByRole('dialog', { name: 'Registro completo' });
  const timeline = panel.getByRole('log', { name: 'Registro completo del análisis' });
  await expect(panel).toBeVisible();
  // The panel opens while the run is still going and it keeps streaming behind it.
  await expect(timeline.getByText('El análisis terminó')).toHaveCount(0);
  const atOpen = await timeline.getByRole('listitem').count();
  await expect(timeline.getByText('El análisis terminó')).toBeVisible();
  expect(await timeline.getByRole('listitem').count()).toBeGreaterThan(atOpen);
  await expect(page).toHaveURL(/\/analisis$/);
  expect(streams).toHaveLength(2);

  await panel.getByLabel('Filtrar por agente').selectOption('qa');
  await expect(timeline.getByRole('listitem').first()).toContainText('QA');
  await panel.getByRole('button', { name: 'Cerrar' }).click();
  await expect(panel).toBeHidden();
  await finishRun(page);

  const card = page.getByRole('region', { name: 'Artefactos' });
  const stories = card.getByRole('navigation', { name: 'Páginas de historias' });
  await expect(stories.getByText('Página 1 de 2')).toBeVisible();
  const before = await card.boundingBox();
  await stories.getByRole('button', { name: 'Siguiente' }).click();
  await expect(stories.getByText('Página 2 de 2')).toBeVisible();
  await expect(card.getByText(/quiero completar el paso 12/)).toBeVisible();
  expect((await card.boundingBox())?.height).toBe(before?.height);

  await card.getByRole('tab', { name: 'Casos de prueba' }).click();
  const cases = card.getByRole('navigation', { name: 'Páginas de casos de prueba' });
  await expect(cases.getByText('Página 1 de 2')).toBeVisible();
  await expect(card.getByRole('table').first().getByText('CP-01')).toBeVisible();
  await cases.getByRole('button', { name: 'Siguiente' }).click();
  await expect(card.getByText('CP-90').first()).toBeVisible();
  await expect(cases.getByRole('button', { name: 'Siguiente' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar' }).click();
  await page.getByRole('button', { name: 'JSON' }).click();
  const exported = JSON.parse(await readFile((await (await download).path()) ?? '', 'utf8'));
  expect(exported.historias).toHaveLength(12);
  expect(exported.casos).toHaveLength(13);
  const markdown = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar' }).click();
  await page.getByRole('button', { name: 'Markdown' }).click();
  const text = await readFile((await (await markdown).path()) ?? '', 'utf8');
  expect(text).toContain('HU-12');
  expect(text).toContain('CP-90');
});

test('ir a Historial y volver conserva la pausa y el resultado sin historial', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await startRun(page);
  await waitForApproval(page);

  await nav.getByRole('link', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { name: 'Historial', level: 1 })).toBeVisible();
  await nav.getByRole('link', { name: 'Nuevo análisis' }).click();
  await waitForApproval(page);

  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);
  await nav.getByRole('link', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { name: 'Historial', level: 1 })).toBeVisible();
  await nav.getByRole('link', { name: 'Nuevo análisis' }).click();

  await finishRun(page);
  await expect(page.getByText('No guardado en tu historial')).toBeVisible();
  await expect(page.getByText(/quiero/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar' })).toBeVisible();
});

test('iniciar otro análisis sin historial avisa antes de perder el actual', async ({ page }) => {
  await startRun(page);
  await waitForApproval(page);
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);
  const run = page.getByRole('button', { name: /^Ejecutar/ });
  const warning = page.getByRole('alertdialog', { name: '¿Descartar el análisis?' });

  await run.click();
  await expect(warning).toContainText('Este análisis no está guardado en tu historial.');
  await warning.getByRole('button', { name: 'Cancelar' }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByText('No guardado en tu historial')).toBeVisible();

  await run.click();
  const download = page.waitForEvent('download');
  await warning.getByRole('button', { name: 'Descargar' }).click();
  expect((await download).suggestedFilename()).toMatch(/^criteria-.*\.md$/);
  await warning.getByRole('button', { name: 'Descartar y continuar' }).click();

  await waitForApproval(page);
  await expect(page.getByText('No guardado en tu historial')).toBeHidden();
});

test('Nuevo análisis limpia el formulario y el resultado después de avisar', async ({ page }) => {
  await startRun(page);
  await waitForApproval(page);
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);
  const warning = page.getByRole('alertdialog', { name: '¿Descartar el análisis?' });

  await page.getByRole('button', { name: 'Nuevo análisis' }).click();
  await warning.getByRole('button', { name: 'Descartar y continuar' }).click();

  await expect(
    page.getByLabel('Describe lo que el sistema debe hacer, en lenguaje natural'),
  ).toHaveValue('');
  await expect(page.getByText('Escribe un requerimiento y ejecuta el análisis')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo análisis' })).toBeHidden();
});

test('un límite de uso se explica en un diálogo sin inventar la hora', async ({ page }) => {
  await page.route('**/runs', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 429,
          contentType: 'application/json',
          // The page and the API are different origins; the real API answers with its CORS header.
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ code: 'limite_hora', message: 'Alcanzaste el límite.' }),
        })
      : route.fallback(),
  );
  await startRun(page);

  const dialog = page.getByRole('alertdialog', {
    name: 'Alcanzaste el límite de análisis por hora',
  });
  await expect(dialog).toContainText('Puedes iniciar hasta 100 análisis por hora y 200 al día.');
  await expect(dialog).not.toContainText(/a las/);
  await dialog.getByRole('button', { name: 'Entendido' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByLabel('Describe lo que el sistema debe hacer, en lenguaje natural'),
  ).not.toHaveValue('');
});

test('el panel del agente se cierra con Esc y con un clic fuera', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Ver agente QA' });
  const panel = page.getByRole('dialog', { name: 'Agente' });
  const scrollLock = () => page.evaluate(() => document.documentElement.style.overflow);

  await opener.click();
  await expect(panel).toBeVisible();
  expect(await scrollLock()).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await scrollLock()).toBe('');

  await opener.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(20, 300);
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();
});

test('con la API lenta aparece la capa de espera y sigue sola al responder', async ({ page }) => {
  await page.route('**/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    return route.continue();
  });
  await startRun(page);

  const status = page.getByRole('status').filter({ hasText: /preparando|listo/ });
  await expect(status).toContainText('Estamos preparando todo');
  await expect(status).toContainText('¡Todo listo!');
  await waitForApproval(page);
  await expect(page.getByText('Estamos preparando todo')).toBeHidden();
});

test('reintentar no crea un segundo análisis cuando el primero sí llegó', async ({ page }) => {
  let posts = 0;
  await page.route('**/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    if (posts > 1) return route.continue();
    // The API creates the analysis, but its answer never reaches the browser.
    await route.fetch();
    return route.abort('connectionreset');
  });
  await startRun(page);

  const layer = page.getByRole('status').filter({ hasText: 'No logramos conectar' });
  await expect(layer).toBeVisible();
  await layer.getByRole('button', { name: 'Reintentar' }).click();
  await expect(layer).toContainText('Tu análisis sí se creó, pero no pudimos abrirlo.');
  expect(posts).toBe(1);

  await layer.getByRole('button', { name: 'Cancelar' }).click();
  await expect(layer).toBeHidden();
  await expect(
    page.getByLabel('Describe lo que el sistema debe hacer, en lenguaje natural'),
  ).not.toHaveValue('');
});

test('si la red falla antes de llegar, reintentar crea el análisis', async ({ page }) => {
  let posts = 0;
  await page.route('**/runs', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    return posts === 1 ? route.abort('internetdisconnected') : route.continue();
  });
  await startRun(page);

  const layer = page.getByRole('status').filter({ hasText: 'No logramos conectar' });
  await layer.getByRole('button', { name: 'Reintentar' }).click();

  await waitForApproval(page);
  expect(posts).toBe(2);
});
