import { expect, test } from '../support/test';

import {
  finishRun,
  PASSWORD,
  signUpByUi,
  startRun,
  uniqueEmail,
  waitForApproval,
} from '../support/helpers';

test('guardar y borrar una clave con el validador simulado', async ({ page }) => {
  await signUpByUi(page, uniqueEmail('claves'));
  await page.goto('/ajustes/modelos');
  const openai = page.getByRole('region', { name: 'OpenAI', exact: true });

  await openai.getByLabel('Clave de API de OpenAI').fill('sk-bad-0000');
  await openai.getByRole('button', { name: 'Guardar y validar' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'El proveedor rechazó la clave.' }),
  ).toBeVisible();

  await openai.getByLabel('Clave de API de OpenAI').fill('sk-e2e-key-1234');
  await openai.getByRole('button', { name: 'Guardar y validar' }).click();
  await expect(openai.getByText('••••1234')).toBeVisible();
  await expect(openai.getByText('Conectada')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('sk-e2e-key-1234');

  await openai.getByRole('button', { name: 'Eliminar' }).click();
  await expect(openai.getByText('Sin conectar')).toBeVisible();
});

test('"Usar el gratuito" crea una corrida con Groq solo tras el clic', async ({ page }) => {
  await signUpByUi(page, uniqueEmail('gratuito'));
  await page.goto('/ajustes/modelos');
  const openai = page.getByRole('region', { name: 'OpenAI', exact: true });
  await openai.getByLabel('Clave de API de OpenAI').fill('sk-nosaldo-9999');
  await openai.getByRole('button', { name: 'Guardar y validar' }).click();
  await expect(openai.getByText('••••9999')).toBeVisible();
  const runs: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/runs'))
      runs.push(request.postData() ?? '');
  });

  await startRun(page, { generation: 'OpenAI · Económico (gpt-6-luna)' });
  await expect(
    page.getByRole('heading', { name: 'Tu clave de OpenAI no tiene saldo' }),
  ).toBeVisible();
  await expect(
    page.getByText('No se envió nada a otro proveedor.', { exact: false }),
  ).toBeVisible();
  expect(runs).toHaveLength(1);

  await page.getByRole('button', { name: 'Usar el gratuito' }).click();
  await waitForApproval(page);
  expect(runs).toHaveLength(2);
  expect(JSON.parse(runs[1] ?? '{}')).toMatchObject({ proveedor: 'groq', juez: 'groq' });
});

test('historial: guardar una corrida, verla y borrarla', async ({ page }) => {
  await signUpByUi(page, uniqueEmail('historial'));
  await startRun(page, { save: true });
  await waitForApproval(page);
  await page.getByRole('button', { name: /^Aprobar/ }).click();
  await finishRun(page);

  await page.getByRole('link', { name: 'Historial' }).click();
  const item = page.getByRole('link', { name: /groq · openai\/gpt-oss-20b · Terminada/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole('heading', { name: 'Corrida guardada' })).toBeVisible();
  await expect(page.getByText(/La biblioteca de la unidad/)).toBeVisible();
  await page.getByRole('link', { name: 'Volver al historial' }).click();
  await page.getByRole('button', { name: 'Borrar mi historial' }).click();
  await expect(page.getByText('Borramos 1 corrida de tu historial.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Aún no tienes corridas guardadas.')).toBeVisible();
});

test('eliminar la cuenta borra al usuario', async ({ page }) => {
  const email = uniqueEmail('borrar');
  await signUpByUi(page, email);
  await page.goto('/ajustes/cuenta');
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar mi cuenta' }).click();
  await expect(page).toHaveURL(/cuenta=eliminada/);
  await expect(page.getByText('Eliminamos tu cuenta y todos tus datos.')).toBeVisible();

  await page.getByRole('radio', { name: 'Iniciar sesión' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Correo o contraseña incorrectos.' }),
  ).toBeVisible();
});
