import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { runSession } from '@/entities/corrida';
import { apiToken, type RunCreatedBody } from '@/shared/api';
import { authClient } from '@/shared/lib/auth/client';
import { fullRun } from '@/shared/lib/testing';

import { Header, initials } from './Header';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/historial/abc',
  useRouter: () => ({ push, refresh }),
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: { signOut: vi.fn(async () => ({})) } }));

describe('Header', () => {
  it('shows only the public link without a session', () => {
    render(<Header user={null} />);

    expect(screen.getByRole('link', { name: 'Evaluación pública' })).toHaveAttribute(
      'href',
      '/evaluacion',
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('marks the current section and signs out clearing the API token', async () => {
    const clear = vi.spyOn(apiToken, 'clear');
    render(
      <Header
        user={{ name: 'Luis Peña', email: 'luis@example.test' }}
        actions={<span>Vista</span>}
      />,
    );

    expect(screen.getByRole('link', { name: 'Historial' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Vista')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cuenta de Luis Peña' }));
    expect(screen.getByText('luis@example.test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(authClient.signOut).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/');
  });

  it('asks before signing out over an analysis without history and then forgets it', async () => {
    vi.mocked(authClient.signOut).mockClear();
    runSession.start({ run_id: 'run-1', guardar_historial: false } as RunCreatedBody, 'Req');
    for (const evento of fullRun()) runSession.apply({ type: 'evento', evento });
    render(<Header user={{ name: 'Ana', email: 'ana@example.test' }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cuenta de Ana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(authClient.signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar y continuar' }));

    expect(authClient.signOut).toHaveBeenCalled();
    expect(runSession.get().created).toBeNull();
  });

  it('opens the navigation on small screens and closes it after a choice', async () => {
    render(<Header user={{ name: '', email: 'ana@example.test' }} />);

    const toggle = screen.getByRole('button', { name: 'Menú' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('navigation')).toHaveAttribute('data-open', 'true');
    await userEvent.click(screen.getByRole('link', { name: 'Evaluación' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Cuenta de ana@example.test' }));
    await userEvent.click(screen.getByRole('link', { name: 'Cuenta' }));
    expect(screen.queryByText('ana@example.test', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('builds initials from names or the email', () => {
    expect(initials('Ángela Núñez', 'x')).toBe('ÁN');
    expect(initials('ana', 'x')).toBe('AN');
    expect(initials('  ', 'zoe@x.mx')).toBe('ZO');
  });
});
