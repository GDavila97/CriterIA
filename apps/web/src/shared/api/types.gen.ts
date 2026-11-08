// Generated from services/api/contract/schema.json by pnpm gen:api; do not edit.

/**
 * Every SSE frame carries one of these in its data line.
 *
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "Evento".
 */
export type Evento =
  | CorridaInicia
  | AgenteInicia
  | AgenteProgreso
  | AgenteEntrega
  | EnEsperaHumano
  | HumanoResponde
  | RevisorObserva
  | AgenteError
  | CorridaFin;

/**
 * HTTP bodies and SSE events of the CriterIA API.
 */
export interface CriteriaContract {
  [k: string]: unknown;
}
/**
 * One agent's tuning; the model stays within the provider of its group.
 *
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgentParamsBody".
 */
export interface AgentParamsBody {
  nivel?: ('economico' | 'equilibrado' | 'maximo') | null;
  modelo?: string | null;
  temperatura?: number | null;
  max_tokens?: number | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgentPromptsBody".
 */
export interface AgentPromptsBody {
  analista: string;
  qa: string;
  revisor: string;
  evaluador: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgenteEntrega".
 */
export interface AgenteEntrega {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'agente_entrega';
  ronda: number;
  artefactos: ArtefactosHistorias | ArtefactosPruebas | ArtefactosRevision | ArtefactosPuntajes;
  uso: Uso;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ArtefactosHistorias".
 */
export interface ArtefactosHistorias {
  tipo: 'historias';
  historias: HistoriaUsuario[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HistoriaUsuario".
 */
export interface HistoriaUsuario {
  id: string;
  como: string;
  quiero: string;
  para: string;
  prioridad: 'alta' | 'media' | 'baja';
  /**
   * @maxItems 8
   */
  supuestos: string[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ArtefactosPruebas".
 */
export interface ArtefactosPruebas {
  tipo: 'pruebas';
  criterios: CriterioAceptacion[];
  casos: CasoPrueba[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CriterioAceptacion".
 */
export interface CriterioAceptacion {
  id: string;
  historia_id: string;
  texto: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CasoPrueba".
 */
export interface CasoPrueba {
  id: string;
  historia_id: string;
  titulo: string;
  /**
   * @minItems 1
   * @maxItems 12
   */
  pasos: [string, ...string[]];
  resultado_esperado: string;
  gherkin: EscenarioGherkin;
  origen: 'qa' | 'revisor';
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "EscenarioGherkin".
 */
export interface EscenarioGherkin {
  escenario: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  dado: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 6
   */
  cuando: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 6
   */
  entonces: [string, ...string[]];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ArtefactosRevision".
 */
export interface ArtefactosRevision {
  tipo: 'revision';
  veredicto: VeredictoRevisor;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "VeredictoRevisor".
 */
export interface VeredictoRevisor {
  aprobado: boolean;
  /**
   * @maxItems 10
   */
  observaciones: Observacion[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "Observacion".
 */
export interface Observacion {
  tipo: 'ambiguedad' | 'inconsistencia' | 'faltante';
  destino: 'analista' | 'qa';
  /**
   * @maxItems 10
   */
  referencias: string[];
  descripcion: string;
  sugerencia: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ArtefactosPuntajes".
 */
export interface ArtefactosPuntajes {
  tipo: 'puntajes';
  puntajes: Puntaje[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "Puntaje".
 */
export interface Puntaje {
  criterio: 'claridad' | 'verificabilidad' | 'completitud' | 'consistencia';
  valor: number;
  justificacion: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "Uso".
 */
export interface Uso {
  tokens_entrada: number;
  tokens_salida: number;
  latencia_ms: number;
  costo_usd: number | null;
  reintentos: number;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgenteError".
 */
export interface AgenteError {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'agente_error';
  codigo:
    | 'salida_invalida'
    | 'clave_invalida'
    | 'sin_saldo'
    | 'limite_proveedor'
    | 'proveedor_no_disponible'
    | 'destino_no_permitido'
    | 'error_interno';
  mensaje: string;
  respaldo_sugerido: 'groq' | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgenteInicia".
 */
export interface AgenteInicia {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'agente_inicia';
  ronda: number;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgenteProgreso".
 */
export interface AgenteProgreso {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'agente_progreso';
  mensaje: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgentsBody".
 */
export interface AgentsBody {
  version_prompts: string;
  version_juez: string;
  prompts: AgentPromptsBody;
  temperatura_maxima: number;
  max_tokens_minimo: number;
  max_tokens_maximo: number;
  rondas_maximas: number;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgentsParamsBody".
 */
export interface AgentsParamsBody {
  analista?: AgentParamsBody | null;
  qa?: AgentParamsBody | null;
  revisor?: AgentParamsBody | null;
  evaluador?: AgentParamsBody | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "AgentsPlanBody".
 */
export interface AgentsPlanBody {
  analista: ModelPlanBody;
  qa: ModelPlanBody;
  revisor: ModelPlanBody;
  evaluador: ModelPlanBody;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ModelPlanBody".
 */
export interface ModelPlanBody {
  proveedor: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible';
  modelo: string;
  clave: 'usuario' | 'servidor';
  temperatura: number;
  max_tokens: number;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CambiosHistorias".
 */
export interface CambiosHistorias {
  agregadas: string[];
  modificadas: string[];
  eliminadas: string[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CatalogBody".
 */
export interface CatalogBody {
  proveedores: CatalogProviderBody[];
  proveedor_predeterminado: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible';
  juez_predeterminado: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible';
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CatalogProviderBody".
 */
export interface CatalogProviderBody {
  proveedor: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible';
  disponible: boolean;
  clave: ('usuario' | 'servidor') | null;
  acepta_clave_propia: boolean;
  niveles: CatalogTierBody[];
  modelos: string[];
  costos_generacion: CatalogModelCostBody[];
  costo_juez_usd: number | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CatalogTierBody".
 */
export interface CatalogTierBody {
  nivel: 'economico' | 'equilibrado' | 'maximo';
  modelo: string;
  costo_estimado_usd: number | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CatalogModelCostBody".
 */
export interface CatalogModelCostBody {
  modelo: string;
  costo_usd: number | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CorridaFin".
 */
export interface CorridaFin {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'corrida_fin';
  estado: 'completada' | 'error';
  puntajes: Puntaje[];
  totales: Totales;
  respaldo_sugerido: 'groq' | null;
  codigo:
    | (
        | 'salida_invalida'
        | 'clave_invalida'
        | 'sin_saldo'
        | 'limite_proveedor'
        | 'proveedor_no_disponible'
        | 'destino_no_permitido'
        | 'error_interno'
      )
    | null;
  mensaje: string | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "Totales".
 */
export interface Totales {
  tokens_entrada: number;
  tokens_salida: number;
  latencia_ms: number;
  costo_usd: number | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CorridaInicia".
 */
export interface CorridaInicia {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'corrida_inicia';
  proveedor: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible';
  modelos: ModelosCorrida;
  version_prompts: string;
  version_juez: string;
  juez_mismo_proveedor: boolean;
  experimental: boolean;
  max_rondas: number;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ModelosCorrida".
 */
export interface ModelosCorrida {
  generacion: string;
  juez: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CredentialBody".
 */
export interface CredentialBody {
  proveedor: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible';
  last4: string;
  validated_at: string;
  base_url: string | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "CredentialPutBody".
 */
export interface CredentialPutBody {
  api_key: string;
  base_url?: string | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "EnEsperaHumano".
 */
export interface EnEsperaHumano {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'en_espera_humano';
  solicitud: 'aprobar_historias';
  historias: HistoriaUsuario[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "ErrorBody".
 */
export interface ErrorBody {
  code: string;
  message: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "EvaluationBatchBody".
 */
export interface EvaluationBatchBody {
  id: string;
  created_at: string;
  provider: string;
  model: string;
  prompt_version: string;
  judge_model: string;
  judge_version: string;
  output_mode: string;
  cases: number;
  valid_rate: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  cost_usd_avg: number | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "EvaluationBody".
 */
export interface EvaluationBody {
  lotes: EvaluationBatchBody[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HumanoResponde".
 */
export interface HumanoResponde {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'humano_responde';
  decision: 'aprobado' | 'editado' | 'otra_version';
  cambios: CambiosHistorias;
  historias: HistoriaUsuario[] | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "RevisorObserva".
 */
export interface RevisorObserva {
  run_id: string;
  seq: number;
  ts: string;
  agent: 'analista' | 'qa' | 'revisor' | 'evaluador' | 'sistema';
  type: 'revisor_observa';
  ronda: number;
  /**
   * @minItems 1
   */
  observaciones: [Observacion, ...Observacion[]];
  se_corrige: boolean;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HealthBody".
 */
export interface HealthBody {
  status: 'ok';
  version: string;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HistoriaUsuarioInput".
 */
export interface HistoriaUsuarioInput {
  id: string;
  como: string;
  quiero: string;
  para: string;
  prioridad: 'alta' | 'media' | 'baja';
  /**
   * @maxItems 8
   */
  supuestos?: string[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "Historias".
 */
export interface Historias {
  /**
   * @minItems 1
   * @maxItems 12
   */
  historias: [HistoriaUsuarioInput, ...HistoriaUsuarioInput[]];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HistoryDeletedBody".
 */
export interface HistoryDeletedBody {
  deleted: number;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HistoryItemBody".
 */
export interface HistoryItemBody {
  id: string;
  status: string;
  requirement: string;
  artifacts: {
    [k: string]: unknown;
  };
  scores: {
    [k: string]: unknown;
  }[];
  provider: string;
  model: string;
  judge_model: string;
  prompt_version: string;
  judge_version: string;
  experimental: boolean;
  totals: {
    [k: string]: unknown;
  };
  created_at: string | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "HistorySummaryBody".
 */
export interface HistorySummaryBody {
  id: string;
  status: string;
  provider: string;
  model: string;
  created_at: string;
  scores: {
    [k: string]: unknown;
  }[];
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "RespuestaHumana".
 */
export interface RespuestaHumana {
  decision: 'aprobado' | 'editado' | 'otra_version';
  historias?: Historias | null;
  nota?: string | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "RunCreateBody".
 */
export interface RunCreateBody {
  requerimiento: string;
  proveedor?: ('openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible') | null;
  nivel?: ('economico' | 'equilibrado' | 'maximo') | null;
  modelo?: string | null;
  juez?: ('openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible') | null;
  max_rondas?: number | null;
  agentes?: AgentsParamsBody | null;
  guardar_historial?: boolean | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "RunCreatedBody".
 */
export interface RunCreatedBody {
  run_id: string;
  generacion: ModelPlanBody;
  juez: ModelPlanBody;
  juez_mismo_proveedor: boolean;
  costo_estimado_usd: number | null;
  costo_servidor_usd: number;
  agentes: AgentsPlanBody;
  max_rondas: number;
  guardar_historial: boolean;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "SettingsBody".
 */
export interface SettingsBody {
  save_history: boolean;
  default_provider: ('openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible') | null;
  default_tier: ('economico' | 'equilibrado' | 'maximo') | null;
  judge_provider: ('openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible') | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "SettingsBodyInput".
 */
export interface SettingsBodyInput {
  save_history?: boolean;
  default_provider?: ('openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible') | null;
  default_tier?: ('economico' | 'equilibrado' | 'maximo') | null;
  judge_provider?: ('openai' | 'anthropic' | 'groq' | 'ollama' | 'openai_compatible') | null;
}
/**
 * This interface was referenced by `CriteriaContract`'s JSON-Schema
 * via the `definition` "UsageBody".
 */
export interface UsageBody {
  corridas_hora: number;
  limite_hora: number;
  corridas_dia: number;
  limite_dia: number;
}
