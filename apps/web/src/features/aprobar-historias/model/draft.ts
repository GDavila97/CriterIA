import type { HistoriaUsuario, RespuestaHumana } from '@/shared/api';

export interface DraftStory {
  historia: HistoriaUsuario;
  incluida: boolean;
}

export const MAX_STORIES = 12;
export const MAX_NOTE = 500;

export function nextId(stories: DraftStory[]): string {
  const numbers = stories.map((s) => Number(s.historia.id.replace('HU-', '')) || 0);
  return `HU-${Math.max(0, ...numbers) + 1}`;
}

export function isComplete(historia: HistoriaUsuario): boolean {
  return [historia.como, historia.quiero, historia.para].every((text) => text.trim().length > 0);
}

/** "aprobado" when nothing changed, otherwise "editado" with the stories that stay. */
export function answerFor(original: HistoriaUsuario[], drafts: DraftStory[]): RespuestaHumana {
  const kept = drafts.filter((d) => d.incluida).map((d) => d.historia);
  const unchanged = JSON.stringify(kept) === JSON.stringify(original);
  if (unchanged) return { decision: 'aprobado' };
  const [first, ...rest] = kept.map((h) => ({
    ...h,
    como: h.como.trim(),
    quiero: h.quiero.trim(),
    para: h.para.trim(),
    supuestos: (h.supuestos ?? []).map((s) => s.trim()).filter(Boolean),
  }));
  if (!first) throw new Error('at least one story must stay');
  return { decision: 'editado', historias: { historias: [first, ...rest] } };
}
