import { expect, test } from '../support/test';

test('con EMAIL_PROVIDER=none no existe la recuperación', async ({ page }) => {
  const response = await page.goto('/recuperar');

  expect(response?.status()).toBe(404);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveCount(0);
});
