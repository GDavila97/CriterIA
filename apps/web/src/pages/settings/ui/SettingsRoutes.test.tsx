import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';

import {
  AccountSettingsRoute,
  HistorySettingsRoute,
  ModelsSettingsRoute,
  SettingsIndexRoute,
} from './SettingsRoutes';

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

describe('settings routes', () => {
  it('send /ajustes to the models section', () => {
    expect(() => SettingsIndexRoute()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/ajustes/modelos');
  });

  it('render each section for the signed-in person', async () => {
    const { unmount } = render(await ModelsSettingsRoute());
    expect(screen.getByRole('heading', { level: 1, name: 'Modelos y claves' })).toBeInTheDocument();
    unmount();
    const account = render(await AccountSettingsRoute());
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    account.unmount();
    render(await HistorySettingsRoute());
    expect(screen.getByRole('heading', { level: 1, name: 'Historial' })).toBeInTheDocument();
  });
});
