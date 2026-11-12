import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

const user = { name: 'Ana', email: 'ana@example.test', providers: ['credential', 'github'] };

import { PrivacyPage } from './PrivacyPage';

describe('PrivacyPage', () => {
  it('privacy mentions the GitHub account only when it applies and shows controls with a session', () => {
    const { unmount } = render(
      <PrivacyPage user={user} contactUrl="https://github.com/GDavila97" />,
    );
    expect(screen.getByText(/Tu cuenta de GitHub:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar mi cuenta' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'github.com/GDavila97' })).toHaveAttribute(
      'href',
      'https://github.com/GDavila97',
    );
    unmount();

    render(<PrivacyPage user={null} contactUrl="mailto:hola@example.com" />);
    expect(screen.getByRole('link', { name: 'hola@example.com' })).toHaveAttribute(
      'href',
      'mailto:hola@example.com',
    );
    expect(screen.queryByText(/Tu cuenta de GitHub:/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Inicia sesión para borrar tu historial, tus claves o tu cuenta.'),
    ).toBeInTheDocument();
  });
});
