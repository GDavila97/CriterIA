import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/shared/api';
import { authClient } from '@/shared/lib/auth/client';

import { DataControls } from './DataControls';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: { deleteUser: vi.fn() } }));

function client() {
  return {
    clearHistory: vi
      .fn()
      .mockResolvedValueOnce({ deleted: 2 })
      .mockResolvedValueOnce({ deleted: 0 }),
    credentials: vi.fn(async () => [
      { proveedor: 'openai' as const, last4: '1234', validated_at: '', base_url: null },
    ]),
    deleteCredential: vi.fn(async () => {}),
  };
}

describe('DataControls', () => {
  it('clears history and keys with plain confirmations', async () => {
    const c = client();
    render(<DataControls client={c} />);

    await userEvent.click(screen.getByRole('button', { name: 'Borrar mi historial' }));
    expect(screen.getByText('Borramos 2 corridas de tu historial.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Borrar mi historial' }));
    expect(screen.getByText('Tu historial ya estaba vacío.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar mis claves' }));
    expect(c.deleteCredential).toHaveBeenCalledWith('openai');
    expect(screen.getByText('Eliminamos tus claves.')).toBeInTheDocument();
  });

  it('shows API errors and handles accounts without keys', async () => {
    const c = {
      ...client(),
      clearHistory: vi
        .fn()
        .mockRejectedValue(new ApiError(500, 'error_interno', 'Ocurrió un error interno.')),
      credentials: vi.fn(async () => []),
    };
    render(<DataControls client={c} show={['historial', 'claves']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Borrar mi historial' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ocurrió un error interno.');
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar mis claves' }));
    expect(screen.getByText('No tenías claves guardadas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar mi cuenta' })).not.toBeInTheDocument();
  });

  it('asks before deleting the account and leaves when it is gone', async () => {
    vi.mocked(authClient.deleteUser)
      .mockResolvedValueOnce({ data: null, error: { status: 403 } } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never);
    render(<DataControls client={client()} show={['cuenta']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar mi cuenta' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo eliminar la cuenta');
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar mi cuenta' }));

    expect(push).toHaveBeenCalledWith('/?cuenta=eliminada');
  });

  it('uses a generic message for unexpected failures', async () => {
    const c = { ...client(), credentials: vi.fn().mockRejectedValue(new Error('x')) };
    render(<DataControls client={c} show={['claves']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar mis claves' }));

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar.');
  });
});
