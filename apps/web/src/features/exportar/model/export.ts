import { CRITERIO_LABEL, OBSERVACION_LABEL, promedio, type RunState } from '@/entities/corrida';

const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');

/** The run as a Markdown document, built in the browser from what the person already sees. */
export function toMarkdown(state: RunState, requerimiento: string): string {
  const parts = [
    '# CriterIA: historias y pruebas',
    '',
    '## Requerimiento',
    '',
    requerimiento.trim(),
    '',
  ];
  if (state.modelos) {
    parts.push(
      `Modelos: generación ${state.modelos.generacion}, juez ${state.modelos.juez}. Prompts ${state.versionPrompts ?? '-'}, juez ${state.versionJuez ?? '-'}.`,
      '',
    );
  }
  parts.push('## Historias de usuario', '');
  for (const h of state.historias) {
    parts.push(
      `### ${h.id} (prioridad ${h.prioridad})`,
      '',
      `Como ${h.como}, quiero ${h.quiero} para ${h.para}.`,
      '',
    );
    if (h.supuestos?.length) parts.push(list(h.supuestos.map((s) => `Supuesto: ${s}`)), '');
  }
  if (state.criterios.length) {
    parts.push(
      '## Criterios de aceptación',
      '',
      list(state.criterios.map((c) => `${c.id} (${c.historia_id}): ${c.texto}`)),
      '',
    );
  }
  if (state.casos.length) {
    parts.push(
      '## Casos de prueba',
      '',
      '| ID | Historia | Caso | Resultado esperado | Origen |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const c of state.casos) {
      const cell = (text: string) => text.replace(/\|/g, '\\|');
      parts.push(
        `| ${c.id} | ${c.historia_id} | ${cell(c.titulo)} | ${cell(c.resultado_esperado)} | ${c.origen === 'revisor' ? 'Revisor' : 'QA'} |`,
      );
    }
    parts.push('', '## Gherkin', '');
    for (const c of state.casos) {
      const g = c.gherkin;
      parts.push(
        '```gherkin',
        `Escenario: ${g.escenario}`,
        ...g.dado.map((s, i) => `  ${i ? 'Y' : 'Dado'} ${s}`),
        ...g.cuando.map((s, i) => `  ${i ? 'Y' : 'Cuando'} ${s}`),
        ...g.entonces.map((s, i) => `  ${i ? 'Y' : 'Entonces'} ${s}`),
        '```',
        '',
      );
    }
  }
  if (state.observaciones.length) {
    parts.push(
      '## Observaciones del Revisor',
      '',
      list(
        state.observaciones.map(
          ({ observacion: o }) =>
            `${OBSERVACION_LABEL[o.tipo]} (${o.referencias.join(', ')}): ${o.descripcion} Sugerencia: ${o.sugerencia}`,
        ),
      ),
      '',
    );
  }
  if (state.puntajes.length) {
    const media = promedio(state.puntajes);
    parts.push(
      `## Rúbrica${media === null ? '' : `: ${media.toFixed(1)} de 5`}`,
      '',
      list(
        state.puntajes.map((p) => `${CRITERIO_LABEL[p.criterio]}: ${p.valor}. ${p.justificacion}`),
      ),
      '',
    );
  }
  parts.push('---', '', 'Propuesta generada por agentes de IA; revísala antes de usarla.', '');
  return parts.join('\n');
}

export function toJson(state: RunState, requerimiento: string): string {
  return `${JSON.stringify(
    {
      requerimiento: requerimiento.trim(),
      modelos: state.modelos,
      version_prompts: state.versionPrompts,
      version_juez: state.versionJuez,
      historias: state.historias,
      criterios: state.criterios,
      casos: state.casos,
      observaciones: state.observaciones.map((o) => ({ ...o.observacion, ronda: o.ronda })),
      puntajes: state.puntajes,
      totales: state.totales,
    },
    null,
    2,
  )}\n`;
}

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
