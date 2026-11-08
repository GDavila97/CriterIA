const AUTH_ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: 'Ya existe una cuenta con este correo.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe una cuenta con este correo.',
  INVALID_EMAIL_OR_PASSWORD: 'Correo o contraseña incorrectos.',
  INVALID_EMAIL: 'Escribe un correo válido.',
  PASSWORD_TOO_SHORT: 'La contraseña debe tener al menos 12 caracteres.',
  PASSWORD_TOO_LONG: 'La contraseña es demasiado larga.',
  EMAIL_NOT_VERIFIED: 'Verifica tu correo antes de entrar; te enviamos un enlace.',
  DEMASIADOS_INTENTOS: 'Demasiados intentos con esta cuenta. Espera unos minutos.',
  INVALID_TOKEN: 'El enlace ya no es válido. Pide uno nuevo.',
};

const OAUTH_ERRORS: Record<string, string> = {
  account_not_linked: 'Ya existe una cuenta con este correo; entra con tu contraseña.',
};

export interface AuthFailure {
  code?: string | undefined;
  status?: number | undefined;
}

/** A safe sentence for each failure; never the server's raw text. */
export function authErrorMessage(error: AuthFailure | null | undefined): string {
  if (error?.status === 429) return 'Demasiados intentos. Espera unos minutos.';
  return (error?.code && AUTH_ERRORS[error.code]) || 'No se pudo completar. Intenta de nuevo.';
}

export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return OAUTH_ERRORS[code] ?? 'No se pudo entrar con GitHub. Intenta de nuevo.';
}
