import type { CasoPrueba, Evento, HistoriaUsuario, Observacion, Puntaje, Uso } from '@/shared/api';

/** Builders for run events, shared by the tests of every layer. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const START = Date.parse('2026-11-07T12:00:00Z');

export const uso = (costo: number | null = 0.001): Uso => ({
  tokens_entrada: 1000,
  tokens_salida: 200,
  latencia_ms: 1500,
  costo_usd: costo,
  reintentos: 0,
});

export const historia = (n: number, quiero = `hacer la tarea ${n}`): HistoriaUsuario => ({
  id: `HU-${n}`,
  como: 'alumna',
  quiero,
  para: 'cumplir el requerimiento',
  prioridad: n === 1 ? 'alta' : 'media',
  supuestos: [`Supuesto de la historia ${n}`],
});

export const caso = (
  n: number,
  origen: 'qa' | 'revisor' = 'qa',
  historiaId = 'HU-1',
): CasoPrueba => ({
  id: `CP-${String(n).padStart(2, '0')}`,
  historia_id: historiaId,
  titulo: `Caso ${n}`,
  pasos: ['Abrir', 'Confirmar'],
  resultado_esperado: `Resultado ${n}`,
  gherkin: {
    escenario: `Escenario ${n}`,
    dado: ['una alumna con sesión'],
    cuando: ['confirma'],
    entonces: ['queda registrado'],
  },
  origen,
});

export const observacion = (destino: 'qa' | 'analista' = 'qa'): Observacion => ({
  tipo: 'faltante',
  destino,
  referencias: ['HU-1'],
  descripcion: 'Falta un caso de error',
  sugerencia: 'Agregar un caso con datos vacíos',
});

export const puntajes = (valores = [4, 4, 3, 5]): Puntaje[] =>
  (['claridad', 'verificabilidad', 'completitud', 'consistencia'] as const).map((criterio, i) => ({
    criterio,
    valor: valores[i] ?? 4,
    justificacion: `Justificación de ${criterio}`,
  }));

type Body = Record<string, unknown> & { type: Evento['type']; agent?: Evento['agent'] };

export function eventsFrom(...bodies: Body[]): Evento[] {
  return bodies.map(
    (body, i) =>
      ({
        run_id: RUN_ID,
        seq: i + 1,
        ts: new Date(START + i * 9_000).toISOString(),
        agent: 'sistema',
        ...body,
      }) as Evento,
  );
}

export const inicia: Body = {
  type: 'corrida_inicia',
  proveedor: 'groq',
  modelos: { generacion: 'groq:openai/gpt-oss-20b', juez: 'groq:openai/gpt-oss-20b' },
  version_prompts: 'v1',
  version_juez: 'v1',
  juez_mismo_proveedor: true,
  experimental: false,
  max_rondas: 2,
};

export const delivers = (
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador',
  artefactos: unknown,
  ronda = 0,
): Body => ({
  type: 'agente_entrega',
  agent,
  ronda,
  artefactos,
  uso: uso(),
});

/** A complete run: stories approved, one correction by QA, then scores. */
export function fullRun(): Evento[] {
  return eventsFrom(
    inicia,
    { type: 'agente_inicia', agent: 'analista', ronda: 0 },
    { type: 'agente_progreso', agent: 'analista', mensaje: 'Redactando historias de usuario' },
    delivers('analista', { tipo: 'historias', historias: [historia(1), historia(2)] }),
    {
      type: 'en_espera_humano',
      agent: 'analista',
      solicitud: 'aprobar_historias',
      historias: [historia(1), historia(2)],
    },
    {
      type: 'humano_responde',
      agent: 'analista',
      decision: 'aprobado',
      cambios: { agregadas: [], modificadas: [], eliminadas: [] },
    },
    { type: 'agente_inicia', agent: 'qa', ronda: 0 },
    delivers('qa', {
      tipo: 'pruebas',
      criterios: [{ id: 'CA-1', historia_id: 'HU-1', texto: 'Se registra' }],
      casos: [caso(1), caso(2, 'qa', 'HU-2')],
    }),
    { type: 'agente_inicia', agent: 'revisor', ronda: 0 },
    delivers('revisor', {
      tipo: 'revision',
      veredicto: { aprobado: false, observaciones: [observacion()] },
    }),
    {
      type: 'revisor_observa',
      agent: 'revisor',
      ronda: 0,
      observaciones: [observacion()],
      se_corrige: true,
    },
    { type: 'agente_inicia', agent: 'qa', ronda: 1 },
    delivers(
      'qa',
      {
        tipo: 'pruebas',
        criterios: [{ id: 'CA-1', historia_id: 'HU-1', texto: 'Se registra' }],
        casos: [caso(1), caso(2, 'qa', 'HU-2'), caso(90, 'revisor')],
      },
      1,
    ),
    { type: 'agente_inicia', agent: 'revisor', ronda: 1 },
    delivers('revisor', { tipo: 'revision', veredicto: { aprobado: true, observaciones: [] } }, 1),
    { type: 'agente_inicia', agent: 'evaluador', ronda: 1 },
    delivers('evaluador', { tipo: 'puntajes', puntajes: puntajes() }),
    {
      type: 'corrida_fin',
      estado: 'completada',
      puntajes: puntajes(),
      totales: { tokens_entrada: 7000, tokens_salida: 1400, latencia_ms: 10500, costo_usd: 0.012 },
      respaldo_sugerido: null,
      codigo: null,
      mensaje: null,
    },
  );
}
