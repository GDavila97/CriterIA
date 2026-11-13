import { latestLink, PASSWORD, uniqueEmail } from '../support/helpers';
import { expect, test } from '../support/test';

test('con EMAIL_PROVIDER=smtp el registro pide verificar el correo', async ({ page, request }) => {
  const email = uniqueEmail('verifica');
  await page.goto('/');
  await expect(page.getByText(/Te enviaremos un correo para verificar tu cuenta/)).toBeVisible();
  await page.getByLabel('Nombre').fill('Ana Correo');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(
    page.getByText('Te enviamos un correo para verificar tu cuenta. Abre el enlace para entrar.'),
  ).toBeVisible();

  await page.getByRole('radio', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Verifica tu correo antes de entrar' }),
  ).toBeVisible();

  await page.goto(await latestLink(request, email, 'Verifica tu correo en CriterIA'));
  await expect(page).toHaveURL(/\/analisis$/);
});

test('con EMAIL_PROVIDER=smtp se recupera la contraseña por correo', async ({ page, request }) => {
  const email = uniqueEmail('recupera');
  await page.goto('/');
  await page.getByLabel('Nombre').fill('Ana Correo');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.goto(await latestLink(request, email, 'Verifica tu correo en CriterIA'));
  await expect(page).toHaveURL(/\/analisis$/);
  await page.context().clearCookies();

  await page.goto('/');
  await page.getByRole('radio', { name: 'Iniciar sesión' }).click();
  await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
  await expect(page.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeVisible();
  await page.getByLabel('Correo').fill(email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText(/Si hay una cuenta con ese correo/)).toBeVisible();
  await page.goto(await latestLink(request, email, 'Restablece tu contraseña de CriterIA'));
  await page.getByLabel('Contraseña nueva', { exact: true }).fill('otra-clave-nueva-123');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Tu contraseña cambió. Ya puedes entrar con ella.')).toBeVisible();

  await page.goto('/');
  await page.getByRole('radio', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('otra-clave-nueva-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/analisis$/);
});
