import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { catalog, settings, usage } from '@/shared/lib/testing';

import { autoJudge, defaultChoice, generationChoices } from '../model/choices';
import { EXAMPLES } from '../model/examples';
import { RunForm } from './RunForm';

describe('RunForm', () => {
  it('runs the free mode by default and tells where the text goes', async () => {
    const onSubmit = vi.fn();
    render(
      <RunForm
        catalog={catalog()}
        settings={null}
        usage={usage(2)}
        busy={false}
        hasRun={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/Tu texto se enviará a/)).toHaveTextContent(
      'Tu texto se enviará a Groq con la clave de CriterIA. No incluyas datos personales ni confidenciales. El juez es del mismo proveedor',
    );
    expect(screen.getByText(/Costo estimado/)).toHaveTextContent(
      '≈ USD 0.0040 por corrida, cubierto por CriterIA',
    );
    expect(screen.getByText('Te quedan 3 de 5 corridas esta hora')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: EXAMPLES[0].label }));
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(onSubmit).toHaveBeenCalledWith({
      requerimiento: EXAMPLES[0].texto,
      proveedor: 'groq',
      nivel: 'economico',
      modelo: undefined,
      juez: undefined,
      guardarHistorial: false,
    });
  });

  it('refuses short requirements and counts characters', async () => {
    const onSubmit = vi.fn();
    render(
      <RunForm
        catalog={catalog()}
        settings={null}
        usage={usage(5)}
        busy={false}
        hasRun
        onSubmit={onSubmit}
      />,
    );

    await userEvent.type(screen.getByLabelText(/Describe lo que el sistema/), 'muy corto');
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar de nuevo' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe entre 20 y 2000 caracteres.');
    expect(screen.getByText('9 / 2000')).toBeInTheDocument();
    expect(screen.getByText('Te quedan 0 de 5 corridas esta hora')).toBeInTheDocument();
  });

  it('sends own-key runs to each chosen provider and keeps the history choice', async () => {
    const onSubmit = vi.fn();
    render(
      <RunForm
        catalog={catalog(true)}
        settings={settings({
          default_provider: 'openai',
          default_tier: 'equilibrado',
          save_history: true,
        })}
        usage={usage(4)}
        busy={false}
        hasRun={false}
        initialRequirement={EXAMPLES[1].texto}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText('Generación')).toHaveValue('openai|equilibrado');
    expect(screen.getByText(/Tu texto se enviará a/)).toHaveTextContent(
      'Tu texto se enviará a OpenAI con tu clave y a Anthropic con tu clave.',
    );
    expect(screen.getByText(/Costo estimado/)).toHaveTextContent(
      'cobrado a tu cuenta del proveedor',
    );
    expect(screen.getByText('Te queda 1 de 5 corridas esta hora')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Juez'), 'groq');
    await userEvent.click(screen.getByLabelText('Guardar esta corrida en mi historial'));
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        proveedor: 'openai',
        nivel: 'equilibrado',
        juez: 'groq',
        guardarHistorial: false,
      }),
    );
  });

  it('asks for the model name of a compatible service and lists local models', async () => {
    const onSubmit = vi.fn();
    render(
      <RunForm
        catalog={catalog(true)}
        settings={null}
        usage={null}
        busy={false}
        hasRun={false}
        initialRequirement={EXAMPLES[2].texto}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('option', { name: 'Ollama · llama3.1:8b' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Generación'), 'openai_compatible|modelo');
    expect(screen.getByText(/sin precio/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Escribe el nombre del modelo.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Modelo del servicio compatible'), 'deepseek-chat');
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ proveedor: 'openai_compatible', modelo: 'deepseek-chat' }),
    );
  });

  it('explains when nothing is available', () => {
    const none = { ...catalog(), proveedores: [] };
    render(
      <RunForm
        catalog={none}
        settings={null}
        usage={null}
        busy={false}
        hasRun={false}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('No hay modelos disponibles');
  });
});

describe('choices', () => {
  it('prefers another provider for the judge and falls back to defaults', () => {
    const all = generationChoices(catalog(true));

    expect(autoJudge(['groq', 'anthropic'], 'anthropic')).toBe('groq');
    expect(autoJudge(['groq'], 'groq')).toBe('groq');
    expect(defaultChoice(all, catalog(true), settings({ default_provider: 'ollama' }))).toBe(
      'ollama|llama3.1:8b',
    );
    expect(defaultChoice([], catalog(), null)).toBe('');
  });
});
