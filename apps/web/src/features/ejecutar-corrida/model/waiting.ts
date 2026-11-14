import type { UsageBody } from '@/shared/api';

/** What the waiting layer shows while an analysis is created and its stream opens. */
export type WaitStage = 'oculta' | 'preparando' | 'listo' | 'sin_conexion' | 'creado_sin_abrir';

export const SHOW_AFTER_MS = 1_500;
export const READY_MS = 700;
export const GIVE_UP_MS = 30_000;

/**
 * Whether a run was created since `before`. The day count only grows within a UTC day, and the
 * hour count covers a run made just before midnight.
 */
export function runArrived(before: UsageBody, after: UsageBody): boolean {
  return after.corridas_dia > before.corridas_dia || after.corridas_hora > before.corridas_hora;
}
