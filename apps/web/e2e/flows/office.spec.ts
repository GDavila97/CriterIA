import { expect, test } from '../support/test';

import { REQUIREMENT, signUpByUi, uniqueEmail } from '../support/helpers';

test.beforeEach(async ({ page }) => {
  await signUpByUi(page, uniqueEmail('oficina'), 'Ana Prueba');
});

test('un análisis completo en la oficina, con la aprobación desde Revisar historias', async ({
  page,
}) => {
  await page.goto('/analisis?vista=oficina');
  const office = page.getByRole('region', { name: 'Oficina' });
  await expect(office).toBeVisible();
  await expect(page.getByRole('region', { name: 'Flujo de agentes' })).toBeHidden();

  await page
    .getByLabel('Describe lo que el sistema debe hacer, en lenguaje natural')
    .fill(REQUIREMENT);
  await page.getByRole('button', { name: /^Ejecutar/ }).click();

  await expect(office.getByText('Ana, necesito tu ayuda')).toBeVisible();
  await expect(office.getByText('Las historias están listas para tu revisión.')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await office.getByRole('button', { name: 'Revisar historias' }).click();
  const drawer = page.getByRole('dialog', { name: 'Revisar historias' });
  await drawer.getByRole('button', { name: /^Aprobar/ }).click();
  await expect(drawer).toBeHidden();

  await expect(office.getByText('Análisis listo')).toBeVisible({ timeout: 30_000 });
  await expect(office.getByText('Análisis terminado.')).toBeAttached();
  await expect(page.getByRole('region', { name: 'Artefactos' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Rúbrica/ })).toContainText('/5');

  await office.getByRole('button', { name: /^Revisor: .*, abrir panel$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Agente' })).toBeVisible();
});

test('el interruptor recuerda la oficina y no aparece a 390 px, donde ?vista=oficina cae a la clásica', async ({
  page,
}) => {
  await page.goto('/analisis');
  const views = page.getByRole('radiogroup', { name: 'Vista' });
  await views.getByRole('radio', { name: 'Oficina' }).check();
  await expect(page.getByRole('region', { name: 'Oficina' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Oficina' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/analisis?vista=oficina');
  await expect(page.getByRole('region', { name: 'Flujo de agentes' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Vista' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Oficina' })).toBeHidden();
});
