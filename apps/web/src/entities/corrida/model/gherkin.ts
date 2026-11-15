import type { CasoPrueba, EscenarioGherkin, HistoriaUsuario } from '@/shared/api';

import type { ObservacionRonda, RunState } from './reducer';

export type GherkinKeyword = 'Dado' | 'Cuando' | 'Entonces' | 'Y' | 'Pero';

export interface GherkinStep {
  keyword: GherkinKeyword;
  /** The model's words, without the conjunction the keyword already says. */
  text: string;
}

const CONJUNCTION = /^(y|pero)\s+/i;

function group(first: GherkinKeyword, steps: readonly string[]): GherkinStep[] {
  return steps.map((raw, i) => {
    const text = raw.trim();
    const conjunction = CONJUNCTION.exec(text);
    // A step that starts with "pero" or "y" keeps that word as its keyword, so nothing repeats.
    if (i > 0 && conjunction) {
      const word = conjunction[1]!.toLowerCase();
      return { keyword: word === 'pero' ? 'Pero' : 'Y', text: text.slice(conjunction[0].length) };
    }
    return { keyword: i ? 'Y' : first, text };
  });
}

export function gherkinSteps(escenario: EscenarioGherkin): GherkinStep[] {
  return [
    ...group('Dado', escenario.dado),
    ...group('Cuando', escenario.cuando),
    ...group('Entonces', escenario.entonces),
  ];
}

export interface Feature {
  historiaId: string;
  /** "Agendar una cita en línea", from the story's "quiero". */
  titulo: string;
  casos: CasoPrueba[];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Scenarios grouped by the story they test, in the stories' order; unknown stories go last. */
export function featuresOf(historias: readonly HistoriaUsuario[], casos: readonly CasoPrueba[]) {
  const order = new Map(historias.map((h, i) => [h.id, i]));
  const byStory = new Map<string, CasoPrueba[]>();
  for (const caso of casos)
    byStory.set(caso.historia_id, [...(byStory.get(caso.historia_id) ?? []), caso]);
  return [...byStory.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    .map(([historiaId, grupo]): Feature => {
      const historia = historias.find((h) => h.id === historiaId);
      return {
        historiaId,
        titulo: historia ? capitalize(historia.quiero.trim()) : '',
        casos: grupo,
      };
    });
}

function scenarioLines(caso: CasoPrueba, indent: string): string[] {
  return [
    `${indent}@${caso.id}`,
    `${indent}Escenario: ${caso.gherkin.escenario}`,
    ...gherkinSteps(caso.gherkin).map((s) => `${indent}  ${s.keyword} ${s.text}`),
  ];
}

export function scenarioText(caso: CasoPrueba): string {
  return scenarioLines(caso, '').join('\n');
}

/** A .feature file in Spanish with one Característica per story. */
export function toFeature(state: Pick<RunState, 'historias' | 'casos'>): string {
  const blocks = featuresOf(state.historias, state.casos).map((feature) =>
    [
      `Característica: ${feature.historiaId}${feature.titulo ? ` ${feature.titulo}` : ''}`,
      ...feature.casos.flatMap((caso) => ['', ...scenarioLines(caso, '  ')]),
    ].join('\n'),
  );
  return ['# language: es', ...blocks].join('\n\n') + '\n';
}

export interface ScenarioOrigin {
  /** "Agregado en la ronda 2 a pedido del Revisor". */
  titulo: string;
  /** The observation, when one alone explains the case. */
  observacion: { numero: number; descripcion: string } | null;
}

/**
 * Why the Reviewer is behind a case, only when the data says so: QA marked it as the Reviewer's,
 * or an observation for QA names that case. The quote needs a single matching observation.
 */
export function scenarioOrigin(
  caso: CasoPrueba,
  observaciones: readonly ObservacionRonda[],
): ScenarioOrigin | null {
  const forQa = observaciones
    .map((item, i) => ({ ...item, numero: i + 1 }))
    .filter((item) => item.observacion.destino === 'qa' && item.seCorrige);
  const naming = forQa.filter((item) => item.observacion.referencias.includes(caso.id));
  if (caso.origen !== 'revisor' && naming.length === 0) return null;
  const candidates = naming.length
    ? naming
    : forQa.filter((item) => item.observacion.referencias.includes(caso.historia_id));
  const only = candidates.length === 1 ? candidates[0]! : null;
  const verbo = caso.origen === 'revisor' ? 'Agregado' : 'Corregido';
  return {
    titulo: only
      ? `${verbo} en la ronda ${only.ronda + 2} a pedido del Revisor`
      : `${verbo} a pedido del Revisor`,
    observacion: only ? { numero: only.numero, descripcion: only.observacion.descripcion } : null,
  };
}
