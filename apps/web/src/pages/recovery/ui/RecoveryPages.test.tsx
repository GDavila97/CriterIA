import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

import { RecoverPage, ResetPage } from './RecoveryPages';

describe('recovery pages', () => {
  it('recovery pages render their forms', () => {
    const { unmount } = render(<RecoverPage />);
    expect(screen.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeInTheDocument();
    unmount();

    render(<ResetPage token="t" />);
    expect(screen.getByLabelText('Contraseña nueva')).toBeInTheDocument();
  });
});
