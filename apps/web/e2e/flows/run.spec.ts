import { expect, test } from '../support/test';

import { API_URL } from '../support/env.mjs';
import { finishRun, signUpByUi, startRun, uniqueEmail, waitForApproval } from '../support/helpers';

test.beforeEach(async ({ page }) => {
  await signUpByUi(page, uniqueEmail('corrida'));
  await expect(page).toHaveURL(/\/corrida$/);
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
  await expect(page.getByText('Editaste las historias (1 modificada, 1 quitada)')).toBeVisible();
  await expect(page.getByText(/quiero apartar un libro desde el celular/)).toBeVisible();
  await page.getByRole('tab', { name: 'Casos de prueba' }).click();
  await expect(page.getByRole('table').getByText('Revisor')).toBeVisible();
  await expect(page.getByRole('region', { name: /Rúbrica/ })).toContainText('4.0');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Markdown' }).click();
  expect((await download).suggestedFilename()).toMatch(/^criteria-.*\.md$/);
});

test('el Analista escribe otra versión hasta dos veces', async ({ page }) => {
  await startRun(page);
  await waitForApproval(page);

  for (const nota of ['Menos historias', '']) {
    await page.getByRole('button', { name: 'Pedir otra versión al Analista' }).click();
    if (nota) await page.getByLabel('¿Qué esperabas? (opcional)').fill(nota);
    await page.getByRole('button', { name: 'Enviar al Analista' }).click();
    await expect(page.getByText('Pediste otra versión de las historias')).toHaveCount(nota ? 1 : 2);
    await waitForApproval(page);
  }

  await expect(page.getByRole('button', { name: 'Pedir otra versión al Analista' })).toBeDisabled();
  await expect(page.getByText(/Ya pediste dos versiones nuevas en esta corrida/)).toBeVisible();
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
  await expect(page.getByText('La corrida empezó')).toHaveCount(1);
});
