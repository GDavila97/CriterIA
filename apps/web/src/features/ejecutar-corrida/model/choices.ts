import type { CatalogBody, CatalogProviderBody, SettingsBody } from '@/shared/api';
import {
  JUDGE_ORDER,
  PROVIDER_NAMES,
  TIER_NAMES,
  type ProviderId,
  type Tier,
} from '@/shared/config/providers';

export interface GenerationChoice {
  value: string;
  label: string;
  provider: ProviderId;
  nivel?: Tier;
  modelo?: string;
  costo: number | null;
}

export const COMPATIBLE_MODEL = 'openai_compatible|modelo';

export function generationChoices(catalog: CatalogBody): GenerationChoice[] {
  return catalog.proveedores
    .filter((p) => p.disponible)
    .flatMap((p): GenerationChoice[] => {
      const name =
        p.proveedor === 'groq' && p.clave === 'servidor'
          ? 'Gratuito (Groq)'
          : PROVIDER_NAMES[p.proveedor];
      if (p.niveles.length) {
        return p.niveles.map((tier) => ({
          value: `${p.proveedor}|${tier.nivel}`,
          label: `${name} · ${TIER_NAMES[tier.nivel]} (${tier.modelo})`,
          provider: p.proveedor,
          nivel: tier.nivel,
          costo: tier.costo_estimado_usd,
        }));
      }
      if (p.proveedor === 'openai_compatible') {
        return [{ value: COMPATIBLE_MODEL, label: name, provider: p.proveedor, costo: null }];
      }
      return p.modelos.map((modelo) => ({
        value: `${p.proveedor}|${modelo}`,
        label: `${name} · ${modelo}`,
        provider: p.proveedor,
        modelo,
        costo: null,
      }));
    });
}

export function defaultChoice(
  choices: GenerationChoice[],
  catalog: CatalogBody,
  settings: SettingsBody | null,
): string {
  const provider = settings?.default_provider ?? catalog.proveedor_predeterminado;
  const tier = settings?.default_tier ?? 'economico';
  return (
    choices.find((c) => c.provider === provider && (c.nivel ?? tier) === tier)?.value ??
    choices.find((c) => c.provider === provider)?.value ??
    choices[0]?.value ??
    ''
  );
}

export function judgeCandidates(catalog: CatalogBody): ProviderId[] {
  return catalog.proveedores
    .filter((p) => p.disponible && p.niveles.some((t) => t.nivel === 'economico'))
    .map((p) => p.proveedor);
}

/** Mirrors the API: a different available provider first, else the generation one. */
export function autoJudge(candidates: ProviderId[], generation: ProviderId): ProviderId {
  return JUDGE_ORDER.find((p) => p !== generation && candidates.includes(p)) ?? generation;
}

function keyOf(catalog: CatalogBody, provider: ProviderId): CatalogProviderBody['clave'] {
  return catalog.proveedores.find((p) => p.proveedor === provider)?.clave ?? null;
}

export function recipients(catalog: CatalogBody, generation: ProviderId, judge: ProviderId) {
  const providers = generation === judge ? [generation] : [generation, judge];
  return providers.map((provider) => ({
    provider,
    nombre: PROVIDER_NAMES[provider],
    clave: keyOf(catalog, provider),
  }));
}
