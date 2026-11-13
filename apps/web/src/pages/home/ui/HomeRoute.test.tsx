import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';

import { getServerEnv } from '@/shared/config/server-env';
import { optionalUser } from '@/shared/lib/auth/guards';

import { HomeRoute } from './HomeRoute';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/shared/lib/auth/guards', () => ({ optionalUser: vi.fn() }));
vi.mock('@/shared/config/server-env', () => ({ getServerEnv: vi.fn() }));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

describe('HomeRoute', () => {
  it('sends signed-in people to the run page', async () => {
    vi.mocked(optionalUser).mockResolvedValueOnce({
      id: 'u',
      name: '',
      email: '',
      emailVerified: true,
      providers: [],
    });

    await expect(HomeRoute({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/analisis');
  });

  it('shows GitHub and the email mode from the server settings', async () => {
    vi.mocked(optionalUser).mockResolvedValueOnce(null);
    vi.mocked(getServerEnv).mockReturnValue({
      GITHUB_CLIENT_ID: 'id',
      EMAIL_PROVIDER: 'none',
    } as never);

    render(
      await HomeRoute({
        searchParams: Promise.resolve({ error: 'account_not_linked', cuenta: 'eliminada' }),
      }),
    );

    expect(screen.getByRole('button', { name: 'Continuar con GitHub' })).toBeInTheDocument();
    expect(screen.getByText('Eliminamos tu cuenta y todos tus datos.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('entra con tu contraseña');
  });
});
