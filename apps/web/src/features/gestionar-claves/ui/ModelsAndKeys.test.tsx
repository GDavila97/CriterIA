import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, type CredentialBody } from '@/shared/api';
import { catalog, settings } from '@/shared/lib/testing';

import { ModelsAndKeys } from './ModelsAndKeys';

const anthropicKey: CredentialBody = {
  proveedor: 'anthropic',
  last4: 'a1b2',
  validated_at: '2026-11-05T12:00:00Z',
  base_url: null,
};

function client(ownKeys = true) {
  return {
    catalog: vi.fn(async () => {
      const c = catalog(ownKeys);
      return {
        ...c,
        proveedores: c.proveedores.map((p) =>
          p.proveedor === 'openai' ? { ...p, disponible: false, clave: null } : p,
        ),
      };
    }),
    credentials: vi.fn(async () => (ownKeys ? [anthropicKey] : [])),
    settings: vi.fn(async () => settings()),
    saveSettings: vi.fn(async (body) => ({ ...settings(), ...body })),
    saveCredential: vi.fn(async () => anthropicKey),
    deleteCredential: vi.fn(async () => {}),
  };
}

describe('ModelsAndKeys', () => {
  it('shows connected and missing keys, never more than the last four characters', async () => {
    render(<ModelsAndKeys client={client()} />);

    const anthropic = await screen.findByRole('region', { name: 'Anthropic' });
    expect(within(anthropic).getByText('••••a1b2')).toBeInTheDocument();
    expect(within(anthropic).getByText(/Validada el 5 nov/)).toBeInTheDocument();
    expect(within(anthropic).getByText('≈ $0.090 por análisis')).toBeInTheDocument();
    const openai = screen.getByRole('region', { name: 'OpenAI' });
    expect(within(openai).getByText('Sin conectar')).toBeInTheDocument();
    expect(within(openai).getByLabelText('Clave de API de OpenAI')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByText('Necesita clave')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /OpenAI/ })).toBeDisabled();
  });

  it('validates and saves a key, then clears the field', async () => {
    const c = client();
    render(<ModelsAndKeys client={c} />);

    const field = await screen.findByLabelText('Clave de API de OpenAI');
    await userEvent.type(field, 'sk-new-0000');
    await userEvent.click(
      within(screen.getByRole('region', { name: 'OpenAI' })).getByRole('button', {
        name: 'Guardar y validar',
      }),
    );

    expect(c.saveCredential).toHaveBeenCalledWith('openai', 'sk-new-0000', undefined);
    await waitFor(() => expect(c.credentials).toHaveBeenCalledTimes(2));
  });

  it('shows the validation error and keeps the field for a retry', async () => {
    const c = {
      ...client(),
      saveCredential: vi
        .fn()
        .mockRejectedValue(new ApiError(422, 'clave_invalida', 'El proveedor rechazó la clave.')),
    };
    render(<ModelsAndKeys client={c} />);

    const compatible = await screen.findByRole('region', { name: 'Compatible con OpenAI' });
    await userEvent.type(
      within(compatible).getByLabelText('URL base (https)'),
      'https://llm.example.com/v1',
    );
    await userEvent.type(
      within(compatible).getByLabelText('Clave de API de Compatible con OpenAI'),
      'sk-bad',
    );
    await userEvent.click(within(compatible).getByRole('button', { name: 'Guardar y validar' }));

    expect(c.saveCredential).toHaveBeenCalledWith(
      'openai_compatible',
      'sk-bad',
      'https://llm.example.com/v1',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('El proveedor rechazó la clave.');
  });

  it('changes the default model, the tier, the judge and deletes keys', async () => {
    const c = client();
    render(<ModelsAndKeys client={c} />);

    await userEvent.click(await screen.findByRole('radio', { name: /Anthropic/ }));
    expect(c.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ default_provider: 'anthropic', default_tier: 'economico' }),
    );
    await userEvent.click(screen.getByRole('radio', { name: /Máximo/ }));
    expect(c.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ default_provider: 'anthropic', default_tier: 'maximo' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Quién califica tus análisis'), 'groq');
    expect(c.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ judge_provider: 'groq' }),
    );
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Anthropic' })).getByRole('button', {
        name: 'Reemplazar',
      }),
    );
    expect(
      within(screen.getByRole('region', { name: 'Anthropic' })).getByLabelText(
        'Clave de API de Anthropic',
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Anthropic' })).getByRole('button', {
        name: 'Eliminar',
      }),
    );
    expect(c.deleteCredential).toHaveBeenCalledWith('anthropic');
    expect(c.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ default_provider: null }),
    );
  });

  it('reports loading and saving failures', async () => {
    const failing = { ...client(), catalog: vi.fn().mockRejectedValue(new Error('down')) };
    const { unmount } = render(<ModelsAndKeys client={failing} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron cargar tus ajustes.',
    );
    unmount();

    const c = {
      ...client(false),
      saveSettings: vi.fn().mockRejectedValue(new Error('x')),
      deleteCredential: vi.fn().mockRejectedValue(new Error('x')),
      saveCredential: vi.fn().mockRejectedValue(new Error('x')),
    };
    render(<ModelsAndKeys client={c} />);
    await userEvent.selectOptions(
      await screen.findByLabelText('Quién califica tus análisis'),
      'groq',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No se guardó el cambio.');
    await userEvent.type(screen.getByLabelText('Clave de API de Groq'), 'gsk');
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Groq con tu cuenta' })).getByRole('button', {
        name: 'Guardar y validar',
      }),
    );
    expect(await screen.findByText('No se pudo validar la clave.')).toBeInTheDocument();
  });

  it('reports a failed deletion', async () => {
    const c = {
      ...client(),
      deleteCredential: vi
        .fn()
        .mockRejectedValue(new ApiError(404, 'no_encontrado', 'No existe o no es tuyo.')),
    };
    render(<ModelsAndKeys client={c} />);

    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Anthropic' })).getByRole('button', {
        name: 'Eliminar',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No existe o no es tuyo.');
  });
});
