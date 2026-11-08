import { catalog } from '@/shared/lib/testing';

import { modelLabel, modelLabelFromId } from './providers';

describe('model labels', () => {
  it('joins the provider name and the display name', () => {
    expect(modelLabel('groq', 'GPT-OSS 20B')).toBe('Groq · GPT-OSS 20B');
    expect(modelLabel('desconocido', 'x')).toBe('desconocido · x');
  });

  it('reads ids such as provider:model, local models with a colon included', () => {
    expect(modelLabelFromId('groq:openai/gpt-oss-20b', catalog())).toBe('Groq · GPT-OSS 20B');
    expect(modelLabelFromId('ollama:llama3.1:8b', catalog())).toBe('Ollama · Llama 3.1 8B');
  });

  it('falls back to the raw model name without a catalog or for unknown models', () => {
    expect(modelLabelFromId('groq:openai/gpt-oss-20b', null)).toBe('Groq · openai/gpt-oss-20b');
    expect(modelLabelFromId('openai_compatible:mi-modelo', catalog())).toBe(
      'Compatible con OpenAI · mi-modelo',
    );
    expect(modelLabelFromId('sin-proveedor', catalog())).toBe('sin-proveedor');
  });
});
