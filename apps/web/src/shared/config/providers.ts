import type { CatalogProviderBody, CatalogTierBody } from '@/shared/api/types.gen';

export type ProviderId = CatalogProviderBody['proveedor'];
export type Tier = CatalogTierBody['nivel'];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  openai_compatible: 'Compatible con OpenAI',
};

export const TIER_NAMES: Record<Tier, string> = {
  economico: 'Económico',
  equilibrado: 'Equilibrado',
  maximo: 'Máximo',
};

/** The judge's preference order, as in the API's elegir_juez. */
export const JUDGE_ORDER: readonly ProviderId[] = [
  'anthropic',
  'openai',
  'groq',
  'openai_compatible',
  'ollama',
];
