import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { MAILPIT_URL } from './env.mjs';

export const PASSWORD = 'una-clave-de-prueba';
export const REQUIREMENT =
  'La biblioteca de la unidad necesita que los alumnos aparten libros en línea y los recojan en el mostrador en 48 horas.';

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export async function signUpByUi(page: Page, email: string, name = 'Ana Prueba'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/corrida$/);
}

/** A session cookie without going through the form, for tests about other screens. */
export async function signUpByApi(
  request: APIRequestContext,
  baseURL: string,
  ip: string,
  email = uniqueEmail('api'),
): Promise<string> {
  const response = await request.post('/api/auth/sign-up/email', {
    data: { name: 'Ana Prueba', email, password: PASSWORD },
    headers: { origin: baseURL, 'x-real-ip': ip },
  });
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return email;
}

export async function startRun(
  page: Page,
  options: { save?: boolean; generation?: string } = {},
): Promise<void> {
  await page.goto('/corrida');
  await page
    .getByLabel('Describe lo que el sistema debe hacer, en lenguaje natural')
    .fill(REQUIREMENT);
  if (options.generation)
    await page.getByLabel('Generación').selectOption({ label: options.generation });
  if (options.save) await page.getByLabel('Guardar esta corrida en mi historial').check();
  await page.getByRole('button', { name: /^Ejecutar/ }).click();
}

export async function waitForApproval(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Revisa las historias antes de seguir' }),
  ).toBeVisible();
}

export async function finishRun(page: Page): Promise<void> {
  await expect(page.getByText(/^Corrida terminada/)).toBeVisible();
}

export function githubCode(id: number, email: string, verified = true): string {
  return `${id}.${Buffer.from(email).toString('base64url')}.${verified ? 1 : 0}`;
}

/** The browser never reaches GitHub: the authorize page answers with a code for the stub. */
export async function fakeGithubAuthorize(page: Page, code: string): Promise<void> {
  await page.route('https://github.com/login/oauth/authorize**', async (route) => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', url.searchParams.get('state') ?? '');
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

export async function latestLink(
  request: APIRequestContext,
  to: string,
  subject: string,
): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const list = await (
        await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
      ).json();
      const message = (list.messages as MailpitMessage[]).find((m) => m.Subject === subject);
      if (!message) return false;
      const body = await (await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json();
      link = /https?:\/\/\S+/.exec(body.Text as string)?.[0];
      return Boolean(link);
    })
    .toBe(true);
  return link as string;
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}
