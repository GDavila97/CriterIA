'use client';

import Link from 'next/link';

import type { ApiError, UsageBody } from '@/shared/api';
import { Button, buttonClass, Dialog } from '@/shared/ui';

type LimitCode = 'limite_hora' | 'limite_dia' | 'cupo_gratuito_agotado';

const LIMIT_CODES: readonly string[] = ['limite_hora', 'limite_dia', 'cupo_gratuito_agotado'];

export function isLimitError(error: ApiError | null): error is ApiError & { code: LimitCode } {
  return error !== null && LIMIT_CODES.includes(error.code);
}

const TITLES: Record<LimitCode, string> = {
  limite_hora: 'Alcanzaste el límite de análisis por hora',
  limite_dia: 'Alcanzaste el límite de análisis del día',
  cupo_gratuito_agotado: 'Se agotó el cupo gratuito de hoy',
};

// The API does not say when the quota frees up, so the dialog never names a time.
function description(code: LimitCode, usage: UsageBody | null): string {
  if (code === 'cupo_gratuito_agotado') {
    return 'El modo gratuito tiene un tope diario compartido por todas las personas. Puedes seguir con tu propia clave de OpenAI, Anthropic o Groq.';
  }
  return usage
    ? `Puedes iniciar hasta ${usage.limite_hora} análisis por hora y ${usage.limite_dia} al día.`
    : 'Cada persona tiene un número de análisis por hora y por día.';
}

function Clock() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export interface LimitDialogProps {
  error: ApiError | null;
  usage: UsageBody | null;
  onClose: () => void;
}

/** Explains why an analysis could not start because of a usage limit. */
export function LimitDialog({ error, usage, onClose }: LimitDialogProps) {
  const code = isLimitError(error) ? error.code : null;
  return (
    <Dialog
      open={code !== null}
      title={code ? TITLES[code] : ''}
      description={code ? description(code, usage) : ''}
      icon={<Clock />}
      onClose={onClose}
      actions={
        <>
          {code === 'cupo_gratuito_agotado' ? (
            <Link href="/ajustes/modelos" className={buttonClass()}>
              Modelos y claves
            </Link>
          ) : (
            <Link href="/historial" className={buttonClass()}>
              Ver historial
            </Link>
          )}
          <Button variant="primary" onClick={onClose}>
            Entendido
          </Button>
        </>
      }
    />
  );
}
