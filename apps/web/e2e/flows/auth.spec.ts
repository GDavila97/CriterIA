import { expect, fakeClientIp, test } from '../support/test';

import {
  fakeGithubAuthorize,
  githubCode,
  PASSWORD,
  signUpByUi,
  uniqueEmail,
} from '../support/helpers';

test('registro con correo y contraseña, con el aviso de que no hay recuperación', async ({
  page,
}) => {
  const email = uniqueEmail('registro');
  await page.goto('/');
  await expect(
    page.getByText('Por ahora no hay recuperación de contraseña. Guárdala en un lugar seguro.'),
  ).toBeVisible();

  await page.getByLabel('Nombre').fill('Ana Prueba');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('corta');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL('/');

  await signUpByUi(page, email);
  await expect(page).toHaveURL(/\/corrida$/);
  await expect(page.getByRole('button', { name: 'Cuenta de Ana Prueba' })).toBeVisible();

  await page.getByRole('button', { name: 'Cuenta de Ana Prueba' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/corrida');
  await expect(page).toHaveURL('/');
  await page.getByRole('radio', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/corrida$/);
});

test('GitHub crea la cuenta con el intercambio simulado', async ({ page }) => {
  await fakeGithubAuthorize(page, githubCode(Date.now() % 1_000_000, uniqueEmail('github')));

  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar con GitHub' }).click();

  await expect(page).toHaveURL(/\/corrida$/);
});

test('GitHub nunca se vincula a una cuenta con el correo sin verificar', async ({ page }) => {
  const email = uniqueEmail('vinculo');
  await signUpByUi(page, email);
  await expect(page).toHaveURL(/\/corrida$/);
  await page.context().clearCookies();
  await fakeGithubAuthorize(page, githubCode(Date.now() % 1_000_000, email));

  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar con GitHub' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Ya existe una cuenta con este correo; entra con tu contraseña.',
  );
  await expect(page).toHaveURL(/\/\?error=account_not_linked/);
});

test('el registro tiene un límite por IP guardado en la base', async ({ request, baseURL }) => {
  const ip = fakeClientIp();
  const statuses: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Límite', email: uniqueEmail('limite'), password: PASSWORD },
      headers: { origin: baseURL ?? '', 'x-forwarded-for': ip },
    });
    statuses.push(response.status());
  }

  expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
  expect(statuses[20]).toBe(429);
});
