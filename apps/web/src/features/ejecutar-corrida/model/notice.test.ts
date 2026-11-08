import { catalog } from '@/shared/lib/testing';

import { generationChoices } from './choices';
import { costText, keyKind, providerNotice, type Part } from './notice';

const text = (parts: Part[]) => parts.map((p) => p.text).join('');

describe('providerNotice', () => {
  it('names the server key for the free mode', () => {
    expect(text(providerNotice([{ provider: 'groq', kind: 'servidor' }], true))).toBe(
      'Tu texto se enviará a Groq con la clave de CriterIA. No incluyas datos personales ni confidenciales. El juez es del mismo proveedor y su calificación puede favorecerlo.',
    );
  });

  it('names the person key for each external provider', () => {
    const parts = providerNotice(
      [
        { provider: 'openai', kind: 'propia' },
        { provider: 'anthropic', kind: 'propia' },
      ],
      false,
    );

    expect(text(parts)).toBe(
      'Tu texto se enviará a OpenAI con tu clave y a Anthropic con tu clave. No incluyas datos personales ni confidenciales.',
    );
    expect(parts.filter((p) => p.strong).map((p) => p.text)).toEqual(['OpenAI', 'Anthropic']);
  });

  it('says a local model needs no key and sends nothing out', () => {
    expect(text(providerNotice([{ provider: 'ollama', kind: 'local' }], true))).toMatch(
      /^Tu texto se procesa en el modelo local configurado, sin enviarse a un proveedor externo\./,
    );
  });

  it('combines a local generation with an external judge', () => {
    expect(
      text(
        providerNotice(
          [
            { provider: 'ollama', kind: 'local' },
            { provider: 'anthropic', kind: 'propia' },
          ],
          false,
        ),
      ),
    ).toBe(
      'Tu texto se procesa en el modelo local configurado y se enviará a Anthropic con tu clave. No incluyas datos personales ni confidenciales.',
    );
  });

  it('classifies keys', () => {
    expect([
      keyKind('ollama', 'servidor'),
      keyKind('groq', 'servidor'),
      keyKind('openai', 'usuario'),
      keyKind('groq', null),
    ]).toEqual(['local', 'servidor', 'propia', 'servidor']);
  });
});

describe('costText', () => {
  const full = catalog(true);
  const choices = generationChoices(full);
  const pick = (value: string) => choices.find((c) => c.value === value)!;

  it('adds both parts for the free mode', () => {
    expect(costText(catalog(), generationChoices(catalog())[0]!, 'groq', 'servidor')).toBe(
      'Costo estimado: ≈ USD 0.0040 por corrida, cubierto por CriterIA.',
    );
  });

  it('adds the judge to a local generation and says the local part is free', () => {
    expect(costText(full, pick('ollama|llama3.1:8b'), 'anthropic', 'propia')).toBe(
      'Costo estimado: ≈ USD 0.0010 por corrida, cobrado a tu cuenta del proveedor. La generación local no tiene costo; el juez (Anthropic) ≈ USD 0.0010.',
    );
  });

  it('splits who pays when the parts use different keys', () => {
    expect(costText(full, pick('openai|equilibrado'), 'groq', 'servidor')).toBe(
      'Costo estimado: ≈ USD 0.0710 por corrida, una parte la cubre CriterIA y otra se cobra a tu cuenta del proveedor.',
    );
  });

  it('names the part without a price', () => {
    expect(costText(full, pick('openai_compatible|modelo'), 'anthropic', 'propia')).toBe(
      'Costo estimado: sin precio para la generación (modelo propio); el juez (Anthropic) ≈ USD 0.0010.',
    );
    expect(costText(full, pick('anthropic|economico'), 'ollama', 'local')).toBe(
      'Costo estimado: ≈ USD 0.0030 de la generación; sin precio para el juez (Ollama).',
    );
    expect(costText(full, pick('openai_compatible|modelo'), 'ollama', 'local')).toBe(
      'Costo estimado: sin precio para la generación ni para el juez.',
    );
  });

  it('reports a free run when every priced part costs nothing', () => {
    const free = {
      ...full,
      proveedores: full.proveedores.map((p) =>
        p.proveedor === 'ollama' ? { ...p, costo_juez_usd: 0 } : p,
      ),
    };

    expect(costText(free, pick('ollama|llama3.1:8b'), 'ollama', 'local')).toBe(
      'Costo estimado: ≈ USD 0.0000 por corrida, sin costo. La generación local no tiene costo; el juez (Ollama) ≈ USD 0.0000.',
    );
  });
});
