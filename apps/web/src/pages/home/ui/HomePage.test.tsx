import { render, screen } from '@testing-library/react';

import { HomePage } from './HomePage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

describe('HomePage', () => {
  it('presents the product, the four agents and the sign-up form', () => {
    render(<HomePage githubEnabled emailMode="none" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'De un requerimiento a casos de prueba, revisados por agentes.',
    );
    expect(screen.getByRole('list', { name: 'Los cuatro agentes' })).toHaveTextContent(
      'AnalistaQARevisorEvaluador',
    );
    expect(screen.getByRole('button', { name: 'Continuar con GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evaluación pública' })).toBeInTheDocument();
  });

  it('confirms a deleted account and passes OAuth errors to the form', () => {
    render(
      <HomePage
        githubEnabled={false}
        emailMode="smtp"
        oauthError="account_not_linked"
        accountDeleted
      />,
    );

    expect(screen.getByText('Eliminamos tu cuenta y todos tus datos.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('entra con tu contraseña');
    expect(screen.queryByRole('button', { name: 'Continuar con GitHub' })).not.toBeInTheDocument();
  });
});
