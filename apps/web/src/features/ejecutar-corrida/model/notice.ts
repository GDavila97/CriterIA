import type { CatalogBody } from '@/shared/api';
import { PROVIDER_NAMES, type ProviderId } from '@/shared/config/providers';

import type { GenerationChoice } from './choices';

export type KeyKind = 'servidor' | 'propia' | 'local';

export interface Part {
  text: string;
  strong?: boolean;
}

/** Ollama runs on the server's configured machine: no key and no external provider. */
export function keyKind(provider: ProviderId, clave: 'usuario' | 'servidor' | null): KeyKind {
  if (provider === 'ollama') return 'local';
  return clave === 'usuario' ? 'propia' : 'servidor';
}

interface Recipient {
  provider: ProviderId;
  kind: KeyKind;
}

function external(r: Recipient): Part[] {
  return [
    { text: PROVIDER_NAMES[r.provider], strong: true },
    { text: r.kind === 'propia' ? ' con tu clave' : ' con la clave de CriterIA' },
  ];
}

/** Where the requirement goes, worded for each mix of server, own and local models. */
export function providerNotice(recipients: Recipient[], sameProvider: boolean): Part[] {
  const local = recipients.filter((r) => r.kind === 'local');
  const remote = recipients.filter((r) => r.kind !== 'local');
  const parts: Part[] = [];
  if (local.length) {
    parts.push(
      { text: 'Tu texto se procesa en el ' },
      { text: 'modelo local configurado', strong: true },
    );
    parts.push({
      text: remote.length ? ' y se enviará a ' : ', sin enviarse a un proveedor externo',
    });
  } else {
    parts.push({ text: 'Tu texto se enviará a ' });
  }
  remote.forEach((r, i) => {
    if (i > 0) parts.push({ text: ' y a ' });
    parts.push(...external(r));
  });
  parts.push({ text: '. No incluyas datos personales ni confidenciales.' });
  if (sameProvider) {
    parts.push({ text: ' El juez es del mismo proveedor y su calificación puede favorecerlo.' });
  }
  return parts;
}

const usd = (value: number) => `USD ${value.toFixed(4)}`;

/** Adds the known parts; says which part has no price instead of hiding the whole estimate. */
export function costText(
  catalog: CatalogBody,
  choice: GenerationChoice,
  judge: ProviderId,
  judgeKind: KeyKind,
): string {
  const provider = catalog.proveedores.find((p) => p.proveedor === choice.provider);
  const model = choice.modelo ?? provider?.niveles.find((t) => t.nivel === choice.nivel)?.modelo;
  const generation = provider?.costos_generacion.find((c) => c.modelo === model)?.costo_usd ?? null;
  const judgeCost = catalog.proveedores.find((p) => p.proveedor === judge)?.costo_juez_usd ?? null;
  const genKind = keyKind(choice.provider, provider?.clave ?? null);
  const judgeName = PROVIDER_NAMES[judge];

  if (generation === null && judgeCost === null) {
    return 'Costo estimado: sin precio para la generación ni para el juez.';
  }
  if (generation === null) {
    return `Costo estimado: sin precio para la generación (${model ?? 'modelo propio'}); el juez (${judgeName}) ≈ ${usd(judgeCost ?? 0)}.`;
  }
  if (judgeCost === null) {
    return `Costo estimado: ≈ ${usd(generation)} de la generación; sin precio para el juez (${judgeName}).`;
  }
  const payers = new Set(
    [generation > 0 ? genKind : null, judgeCost > 0 ? judgeKind : null].filter(
      (k): k is KeyKind => k !== null && k !== 'local',
    ),
  );
  const who =
    payers.size === 0
      ? 'sin costo'
      : payers.size > 1
        ? 'una parte la cubre CriterIA y otra se cobra a tu cuenta del proveedor'
        : payers.has('servidor')
          ? 'cubierto por CriterIA'
          : 'cobrado a tu cuenta del proveedor';
  const local =
    genKind === 'local'
      ? ` La generación local no tiene costo; el juez (${judgeName}) ≈ ${usd(judgeCost)}.`
      : '';
  return `Costo estimado: ≈ ${usd(generation + judgeCost)} por análisis, ${who}.${local}`;
}
