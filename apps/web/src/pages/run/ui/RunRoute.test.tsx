import { render, screen } from '@testing-library/react';

import { RunRoute } from './RunRoute';

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

describe('RunRoute', () => {
  it('renders the workspace for the signed-in person', async () => {
    render(await RunRoute({ searchParams: Promise.resolve({ vista: 'oficina' }) }));

    expect(screen.getByRole('button', { name: 'Cuenta de Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Vista' })).not.toBeInTheDocument();
  });
});
