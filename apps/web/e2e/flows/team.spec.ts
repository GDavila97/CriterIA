import type { Page } from '@playwright/test';

import {
  finishRun,
  REQUIREMENT,
  signUpByUi,
  startRun,
  uniqueEmail,
  waitForApproval,
} from '../support/helpers';
import { expect, test } from '../support/test';

test.beforeEach(async ({ page }) => {
  await signUpByUi(page, uniqueEmail('equipo'), 'Ana Prueba');
});

async function finishedRun(page: Page, options: { save?: boolean } = {}) {
  await startRun(page, options);
  await waitForApproval(page);
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);
}

const team = (page: Page) => page.getByRole('region', { name: 'Así trabajó el equipo' });

test('la vista clásica muestra la corrección del Revisor, toda la conversación, sus filtros y enlaces', async ({
  page,
}) => {
  await finishedRun(page);
  const messages = team(page).getByRole('listitem');
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toContainText('Revisor→QA');
  await expect(messages.first()).toContainText('Corrección');
  await expect(team(page)).toContainText('7 mensajes · 1 corrección');

  await team(page).getByRole('button', { name: 'Ver toda la conversación (7)' }).click();
  await expect(messages).toHaveCount(7);
  await expect(messages.first()).toContainText('Entregué 3 historias de usuario');
  const filters = team(page).getByRole('group', { name: 'Filtrar mensajes' });
  await filters.getByRole('button', { name: 'Tu aprobación' }).click();
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toContainText('Aprobaste las historias sin cambios.');
  await filters.getByRole('button', { name: 'Entregas' }).click();
  await expect(messages).toHaveCount(5);
  await filters.getByRole('button', { name: 'Correcciones' }).click();
  await expect(messages).toHaveCount(1);

  await team(page).getByRole('button', { name: 'Ver O-1' }).click();
  await expect(page.getByRole('tab', { name: 'Observaciones' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#ref-observacion-O-1')).toBeFocused();

  await filters.getByRole('button', { name: 'Todo' }).click();
  await team(page).getByRole('button', { name: 'Ver CP-90' }).click();
  await expect(page.getByRole('tab', { name: 'Casos de prueba' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#ref-caso-CP-90')).toBeFocused();
});

test('el diagrama del equipo pone cada paso en su carril y muestra su detalle', async ({
  page,
}) => {
  await finishedRun(page);
  await team(page).getByRole('radio', { name: 'Diagrama' }).click();

  const detail = page.getByRole('region', { name: 'Detalle del paso' });
  await expect(detail).toHaveAttribute('aria-live', 'polite');
  await expect(detail).toContainText('Revisor → QA');
  await team(page)
    .getByRole('button', { name: /^QA: ?Agrega CP-90 ?Datos incompletos/ })
    .click();
  await expect(detail).toContainText('Agregué CP-90 para atender la observación del Revisor.');
  await detail.getByRole('button', { name: 'Ver CP-90' }).click();
  await expect(page.locator('#ref-caso-CP-90')).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(team(page).getByRole('radiogroup', { name: 'Forma de ver' })).toBeHidden();
  await expect(team(page).getByRole('listitem').first()).toBeVisible();
});

test('el Gherkin se agrupa por historia y el caso del Revisor lleva a su observación', async ({
  page,
}) => {
  await finishedRun(page);
  await page.getByRole('tab', { name: 'Gherkin' }).click();
  const story = page.getByRole('region', { name: /^HU-1 / });
  await expect(story.getByText('Escrito por QA')).toBeVisible();
  const added = story.getByRole('article', { name: 'Escenario CP-90' });
  await expect(added).toContainText('Agregado en la ronda 2 a pedido del Revisor');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar .feature' }).click();
  expect((await download).suggestedFilename()).toMatch(/^criteria-[\w-]{8}\.feature$/);

  await added.getByRole('button', { name: 'Ver la observación O-1' }).click();
  await expect(page.locator('#ref-observacion-O-1')).toBeFocused();
});

test('la oficina cuenta en vivo lo que se dicen los agentes y sus enlaces abren la pestaña', async ({
  page,
}) => {
  await page.goto('/analisis?vista=oficina');
  await page
    .getByLabel('Describe lo que el sistema debe hacer, en lenguaje natural')
    .fill(REQUIREMENT);
  await page.getByRole('button', { name: /^Ejecutar/ }).click();
  const office = page.getByRole('region', { name: 'Oficina' });
  const live = office.getByRole('log');
  await expect(live).toContainText('Entregué 3 historias de usuario a partir del requerimiento.');

  await office.getByRole('button', { name: 'Revisar historias' }).click();
  await page
    .getByRole('dialog', { name: 'Revisar historias' })
    .getByRole('button', { name: /^Aprobar/ })
    .click();
  await expect(live).toContainText('Califiqué el análisis', { timeout: 30_000 });
  await expect(live.getByRole('listitem')).toHaveCount(4);

  await live.getByRole('button', { name: 'Ver CP-90' }).click();
  await expect(page.getByRole('tab', { name: 'Casos de prueba' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('el detalle de un análisis guardado muestra cómo trabajó el equipo y se puede eliminar', async ({
  page,
}) => {
  await finishedRun(page, { save: true });
  await page.goto('/historial');
  await page.getByRole('link', { name: /Groq · GPT-OSS 20B · Terminada/ }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: /^La biblioteca de la unidad necesita/ }),
  ).toBeVisible();
  await expect(page.getByText(/^Guardado el /)).toBeVisible();
  const summary = page.getByRole('list', { name: 'Resumen del análisis' });
  await expect(summary).toContainText('Casos4');
  await expect(team(page).getByRole('listitem')).toHaveCount(7);
  await page.getByText('Requerimiento', { exact: true }).click();
  await expect(page.getByText(REQUIREMENT, { exact: true })).toBeHidden();

  await page.getByRole('button', { name: 'Eliminar' }).click();
  await page
    .getByRole('alertdialog', { name: '¿Eliminar este análisis?' })
    .getByRole('button', { name: 'Eliminar' })
    .click();
  await expect(page).toHaveURL(/\/historial$/);
  await expect(page.getByText('Aún no tienes análisis guardados.')).toBeVisible();
});
