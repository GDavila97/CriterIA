import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/shared/api';
import { settings } from '@/shared/lib/testing';

import { AccountSettingsPage, HistorySettingsPage, ModelsSettingsPage } from './SettingsPages';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/ajustes/cuenta',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));
vi.mock('@/shared/api/endpoints', () => ({
  api: {
    catalog: vi.fn(() => new Promise(() => {})),
    credentials: vi.fn(() => new Promise(() => {})),
    settings: vi.fn(() => new Promise(() => {})),
  },
}));

const user = { name: 'Ana', email: 'ana@example.test', providers: ['credential', 'github'] };

describe('settings pages', () => {
  it('marks the current section and shows the account with its sign-in methods', () => {
    render(<AccountSettingsPage user={user} />);

    expect(screen.getByRole('link', { name: 'Cuenta', current: 'page' })).toBeInTheDocument();
    expect(screen.getByText('Correo y contraseña, GitHub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar mi cuenta' })).toBeInTheDocument();
  });

  it('renders the models page around its feature', () => {
    render(<ModelsSettingsPage user={user} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Modelos y claves' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Cargando tus ajustes' })).toBeInTheDocument();
  });

  it('turns the history setting on and reports failures', async () => {
    const client = {
      settings: vi.fn(async () => settings()),
      saveSettings: vi
        .fn()
        .mockImplementationOnce(async (body) => body)
        .mockRejectedValueOnce(new ApiError(500, 'error_interno', 'Ocurrió un error interno.')),
    };
    render(<HistorySettingsPage user={user} client={client} />);

    const box = await screen.findByLabelText('Guardar mis análisis por defecto');
    await screen.findByRole('checkbox', { checked: false });
    await userEvent.click(box);
    expect(client.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ save_history: true }),
    );
    await userEvent.click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error interno.');
  });

  it('reports settings that do not load', async () => {
    render(
      <HistorySettingsPage
        user={user}
        client={{ settings: vi.fn().mockRejectedValue(new Error('x')), saveSettings: vi.fn() }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron cargar tus ajustes.',
    );
  });

  it('uses a generic message when saving fails unexpectedly', async () => {
    const client = {
      settings: vi.fn(async () => settings()),
      saveSettings: vi.fn().mockRejectedValue(new Error('x')),
    };
    render(<HistorySettingsPage user={user} client={client} />);

    await userEvent.click(await screen.findByRole('checkbox', { checked: false }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó el cambio.');
  });
});
