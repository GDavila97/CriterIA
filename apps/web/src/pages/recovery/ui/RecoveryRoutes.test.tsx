import { render, screen } from '@testing-library/react';

import { getServerEnv } from '@/shared/config/server-env';

import { RecoverRoute, ResetRoute } from './RecoveryRoutes';

vi.mock('@/shared/lib/auth/guards', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    name: 'Ana',
    email: 'ana@example.test',
    emailVerified: true,
    providers: ['github'],
  })),
  optionalUser: vi.fn(async () => null),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));
vi.mock('@/shared/api/endpoints', () => ({
  api: new Proxy({}, { get: () => vi.fn(() => new Promise(() => {})) }),
}));
vi.mock('@/shared/config/server-env', () => ({ getServerEnv: vi.fn() }));

describe('recovery routes', () => {
  it('do not exist without email', async () => {
    vi.mocked(getServerEnv).mockReturnValue({ EMAIL_PROVIDER: 'none' } as never);

    expect(() => RecoverRoute()).toThrow('NEXT_NOT_FOUND');
    await expect(ResetRoute({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('render with an email provider', async () => {
    vi.mocked(getServerEnv).mockReturnValue({ EMAIL_PROVIDER: 'smtp' } as never);

    const { unmount } = render(RecoverRoute());
    expect(screen.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeInTheDocument();
    unmount();
    render(await ResetRoute({ searchParams: Promise.resolve({ token: 'abc' }) }));
    expect(screen.getByLabelText('Contraseña nueva')).toBeInTheDocument();
  });
});
