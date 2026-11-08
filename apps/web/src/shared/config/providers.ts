import type { CatalogBody, CatalogProviderBody, CatalogTierBody } from '@/shared/api/types.gen';

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

const providerName = (provider: string): string =>
  PROVIDER_NAMES[provider as ProviderId] ?? provider;

/** "Groq · GPT-OSS 20B": the provider and the catalog's display_name. */
export function modelLabel(provider: string, displayName: string): string {
  return `${providerName(provider)} · ${displayName}`;
}

/** The same label for an id such as "groq:openai/gpt-oss-20b", looked up in the catalog. */
export function modelLabelFromId(id: string, catalog: CatalogBody | null | undefined): string {
  const [provider = '', ...rest] = id.split(':');
  const model = rest.join(':');
  if (!model) return id;
  const display = catalog?.proveedores.find((p) => p.proveedor === provider)?.display_names[model];
  return modelLabel(provider, display ?? model);
}
