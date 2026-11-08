import type { EmailMessage } from './sender';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function message(
  to: string,
  subject: string,
  intro: string,
  action: string,
  url: string,
): EmailMessage {
  const safeUrl = escapeHtml(url);
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\nSi no fuiste tú, ignora este correo.\n\nCriterIA`,
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<p><a href="${safeUrl}">${escapeHtml(action)}</a></p>`,
      '<p>Si no fuiste tú, ignora este correo.</p>',
      '<p>CriterIA</p>',
    ].join(''),
  };
}

export const verificationEmail = (to: string, url: string) =>
  message(
    to,
    'Verifica tu correo en CriterIA',
    'Confirma que este correo es tuyo para empezar a usar CriterIA.',
    'Verificar mi correo',
    url,
  );

export const resetPasswordEmail = (to: string, url: string) =>
  message(
    to,
    'Restablece tu contraseña de CriterIA',
    'Recibimos una solicitud para restablecer tu contraseña. El enlace vence en una hora.',
    'Elegir una contraseña nueva',
    url,
  );
