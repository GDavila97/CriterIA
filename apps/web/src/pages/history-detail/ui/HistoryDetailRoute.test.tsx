import { render, screen } from '@testing-library/react';

import { HistoryDetailRoute } from './HistoryDetailRoute';

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

describe('HistoryDetailRoute', () => {
  it('renders one saved run', async () => {
    render(await HistoryDetailRoute({ params: Promise.resolve({ id: 'r1' }) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Corrida guardada' })).toBeInTheDocument();
  });
});
