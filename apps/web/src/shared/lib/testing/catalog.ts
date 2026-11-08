import type { AgentsBody, CatalogBody, SettingsBody, UsageBody } from '@/shared/api';

export const catalog = (withOwnKeys = false): CatalogBody => ({
  proveedor_predeterminado: 'groq',
  juez_predeterminado: withOwnKeys ? 'anthropic' : 'groq',
  proveedores: [
    {
      proveedor: 'openai',
      disponible: withOwnKeys,
      clave: withOwnKeys ? 'usuario' : null,
      acepta_clave_propia: true,
      niveles: [
        { nivel: 'economico', modelo: 'gpt-6-luna', costo_estimado_usd: 0.004 },
        { nivel: 'equilibrado', modelo: 'gpt-6.1-sol', costo_estimado_usd: 0.09 },
        { nivel: 'maximo', modelo: 'gpt-6-astra', costo_estimado_usd: 0.4 },
      ],
      modelos: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.4-mini'],
      costos_generacion: [
        { modelo: 'gpt-6-luna', costo_usd: 0.003 },
        { modelo: 'gpt-6.1-sol', costo_usd: 0.07 },
        { modelo: 'gpt-6-astra', costo_usd: 0.35 },
        { modelo: 'gpt-5.4-mini', costo_usd: null },
      ],
      costo_juez_usd: 0.001,
    },
    {
      proveedor: 'anthropic',
      disponible: withOwnKeys,
      clave: withOwnKeys ? 'usuario' : null,
      acepta_clave_propia: true,
      niveles: [
        { nivel: 'economico', modelo: 'claude-haiku-5-5', costo_estimado_usd: 0.004 },
        { nivel: 'equilibrado', modelo: 'claude-sonnet-5-5', costo_estimado_usd: 0.09 },
        { nivel: 'maximo', modelo: 'claude-opus-5-5', costo_estimado_usd: 0.18 },
      ],
      modelos: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
      costos_generacion: [
        { modelo: 'claude-haiku-5-5', costo_usd: 0.003 },
        { modelo: 'claude-sonnet-5-5', costo_usd: 0.07 },
        { modelo: 'claude-opus-5-5', costo_usd: 0.14 },
      ],
      costo_juez_usd: 0.001,
    },
    {
      proveedor: 'groq',
      disponible: true,
      clave: 'servidor',
      acepta_clave_propia: true,
      niveles: [{ nivel: 'economico', modelo: 'openai/gpt-oss-20b', costo_estimado_usd: 0.004 }],
      modelos: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
      costos_generacion: [
        { modelo: 'openai/gpt-oss-20b', costo_usd: 0.003 },
        { modelo: 'llama-3.3-70b-versatile', costo_usd: 0.02 },
      ],
      costo_juez_usd: 0.001,
    },
    {
      proveedor: 'ollama',
      disponible: withOwnKeys,
      clave: withOwnKeys ? 'servidor' : null,
      acepta_clave_propia: false,
      niveles: [],
      modelos: ['llama3.1:8b'],
      costos_generacion: [{ modelo: 'llama3.1:8b', costo_usd: 0 }],
      costo_juez_usd: null,
    },
    {
      proveedor: 'openai_compatible',
      disponible: withOwnKeys,
      clave: withOwnKeys ? 'usuario' : null,
      acepta_clave_propia: true,
      niveles: [],
      modelos: [],
      costos_generacion: [],
      costo_juez_usd: null,
    },
  ],
});

export const settings = (overrides: Partial<SettingsBody> = {}): SettingsBody => ({
  save_history: false,
  default_provider: null,
  default_tier: null,
  judge_provider: null,
  ...overrides,
});

export const usage = (used = 2): UsageBody => ({
  corridas_hora: used,
  limite_hora: 5,
  corridas_dia: used,
  limite_dia: 20,
});

export const agentsGuide = (): AgentsBody => ({
  version_prompts: 'v1',
  version_juez: 'v1',
  prompts: {
    analista: 'Eres el Analista de un equipo de ingeniería de requisitos.',
    qa: 'Eres QA.',
    revisor: 'Eres el Revisor de un equipo de ingeniería de requisitos.',
    evaluador: 'Eres el Evaluador.',
  },
  temperatura_maxima: 1,
  max_tokens_minimo: 256,
  max_tokens_maximo: 8192,
  rondas_maximas: 3,
});
