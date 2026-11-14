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

test('al hacer scroll, nada de la oficina queda encima del encabezado', async ({ page }) => {
  await page.goto('/analisis?vista=oficina');
  const stage = page.getByRole('region', { name: 'Oficina' });
  await expect(stage).toBeVisible();
  const header = page.getByRole('banner');
  const height = (await header.boundingBox())!.height;

  // Scroll the scene under the sticky header, then probe the header's whole strip.
  for (const offset of [0.25, 0.5, 0.75]) {
    await page.evaluate((fraction) => {
      const scene = document.querySelector('section[aria-labelledby="office-title"]')!;
      const top = scene.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + scene.clientHeight * fraction - 40);
    }, offset);
    const covered = await page.evaluate((y) => {
      const hits: string[] = [];
      for (let x = 8; x < window.innerWidth; x += 24) {
        const element = document.elementFromPoint(x, y);
        if (element && !element.closest('header')) hits.push(element.outerHTML.slice(0, 60));
      }
      return hits;
    }, height / 2);
    expect(covered).toEqual([]);
  }
});

test('las patas se mueven durante todo el trayecto y se quedan quietas en reposo', async ({
  page,
}) => {
  await page.goto('/analisis?vista=oficina');
  const walking = page.locator('[data-walking] [data-testid="ficha-walking"] rect').first();
  await expect(walking).toBeAttached();
  expect(await walking.evaluate((leg) => getComputedStyle(leg).animationName)).not.toBe('none');

  const resting = page.locator('[data-agent]:not([data-walking]) [data-testid="ficha-legs"] rect');
  await expect(resting.first()).toBeAttached();
  expect(await resting.first().evaluate((leg) => getComputedStyle(leg).animationName)).toBe('none');
});

test('con movimiento reducido la oficina no anima nada', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/analisis?vista=oficina');
  const office = page.getByRole('region', { name: 'Oficina' });
  await expect(office).toBeVisible();
  await page.waitForTimeout(3_000);

  await expect(page.locator('[data-walking]')).toHaveCount(0);
  const running = await office.evaluate(
    (element) => element.getAnimations({ subtree: true }).length,
  );
  expect(running).toBe(0);
});
