// The API still words these with "corrida"; the interface says "análisis". Codes stay the contract.
const USER_MESSAGES: Readonly<Record<string, string>> = {
  estado_invalido: 'El análisis no está en un estado que permita esta acción.',
  stream_activo: 'Este análisis ya está abierto en otra pestaña.',
  versiones_agotadas: 'Ya pediste dos versiones nuevas de las historias en este análisis.',
  limite_hora: 'Alcanzaste el límite de análisis por hora.',
  limite_dia: 'Alcanzaste el límite de análisis por día.',
};

const RUN_MESSAGES: Readonly<Record<string, string>> = {
  error_interno: 'El análisis se detuvo por un error interno. Intenta de nuevo.',
};

/** The message for an HTTP error code, falling back to what the API sent. */
export function userMessage(code: string, fallback: string): string {
  return USER_MESSAGES[code] ?? fallback;
}

/** The message for an error that ends an analysis on the stream. */
export function runMessage(code: string, fallback: string): string {
  return RUN_MESSAGES[code] ?? fallback;
}
