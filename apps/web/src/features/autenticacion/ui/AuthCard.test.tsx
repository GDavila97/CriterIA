import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { authClient } from '@/shared/lib/auth/client';

import { authErrorMessage, oauthErrorMessage } from '../model/messages';
import { AuthCard } from './AuthCard';
import { RecoverForm, ResetForm } from './RecoveryForms';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/shared/lib/auth/client', () => ({
  authClient: {
    signIn: { social: vi.fn(), email: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(async () => ({ data: {}, error: null })),
    resetPassword: vi.fn(),
  },
}));

const client = vi.mocked(authClient, true);

async function fill(fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    await userEvent.type(screen.getByLabelText(label), value);
  }
}

beforeEach(() => vi.clearAllMocks());

describe('AuthCard', () => {
  it('puts GitHub first and warns there is no recovery while email is off', () => {
    render(<AuthCard githubEnabled emailMode="none" />);

    const github = screen.getByRole('button', { name: 'Continuar con GitHub' });
    const create = screen.getByRole('button', { name: 'Crear cuenta' });
    expect(github.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByText('Por ahora no hay recuperación de contraseña. Guárdala en un lugar seguro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toHaveAccessibleDescription('Mínimo 12 caracteres');
  });

  it('signs up with 12+ characters and goes to the run page', async () => {
    client.signUp.email.mockResolvedValue({ data: {}, error: null } as never);
    render(<AuthCard githubEnabled={false} emailMode="none" />);

    await fill({ Nombre: 'Ana', Correo: 'ana@example.test', Contraseña: 'short' });
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos 12 caracteres');

    await userEvent.type(screen.getByLabelText('Contraseña'), '-long-enough');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(client.signUp.email).toHaveBeenCalledWith({
      name: 'Ana',
      email: 'ana@example.test',
      password: 'short-long-enough',
      callbackURL: '/corrida',
    });
    expect(push).toHaveBeenCalledWith('/corrida');
  });

  it('asks to verify the email when it can be sent', async () => {
    client.signUp.email.mockResolvedValue({ data: {}, error: null } as never);
    render(<AuthCard githubEnabled={false} emailMode="smtp" />);

    expect(screen.getByText(/Te enviaremos un correo/)).toBeInTheDocument();
    await fill({ Nombre: 'Ana', Correo: 'ana@example.test', Contraseña: 'una-clave-larga' });
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(screen.getByText(/Te enviamos un correo para verificar/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('signs in, shows safe errors and offers recovery only with email', async () => {
    client.signIn.email
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'raw' },
      } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never);
    render(<AuthCard githubEnabled={false} emailMode="resend" />);

    await userEvent.click(screen.getByRole('radio', { name: 'Iniciar sesión' }));
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute(
      'href',
      '/recuperar',
    );
    await fill({ Correo: 'ana@example.test', Contraseña: 'una-clave-larga' });
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(screen.queryByText('raw')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(push).toHaveBeenCalledWith('/corrida');
  });

  it('starts GitHub and shows the linking message after a refused link', async () => {
    client.signIn.social.mockResolvedValue({ data: null, error: { status: 500 } } as never);
    render(<AuthCard githubEnabled emailMode="none" oauthError="account_not_linked" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ya existe una cuenta con este correo; entra con tu contraseña.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continuar con GitHub' }));

    expect(client.signIn.social).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/corrida',
      errorCallbackURL: '/',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar');
  });
});

describe('recovery', () => {
  it('never says whether the account exists', async () => {
    render(<RecoverForm />);

    await fill({ Correo: 'nadie@example.test' });
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    expect(client.requestPasswordReset).toHaveBeenCalledWith({
      email: 'nadie@example.test',
      redirectTo: '/restablecer',
    });
    expect(screen.getByText(/Si hay una cuenta con ese correo/)).toBeInTheDocument();
  });

  it('sets a new password with the token or explains an invalid link', async () => {
    client.resetPassword
      .mockResolvedValueOnce({ data: null, error: { code: 'INVALID_TOKEN', status: 400 } } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never);
    const { unmount } = render(<ResetForm token="tok" />);

    await fill({ 'Contraseña nueva': 'corta' });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('12 caracteres');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), '-ya-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El enlace ya no es válido.');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(
      screen.getByText('Tu contraseña cambió. Ya puedes entrar con ella.'),
    ).toBeInTheDocument();
    unmount();

    render(<ResetForm token={null} />);
    expect(screen.queryByLabelText('Contraseña nueva')).not.toBeInTheDocument();
  });
});

describe('messages', () => {
  it('map codes to safe sentences', () => {
    expect(authErrorMessage({ status: 429 })).toMatch(/Demasiados intentos/);
    expect(authErrorMessage(null)).toBe('No se pudo completar. Intenta de nuevo.');
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage('state_mismatch')).toBe(
      'No se pudo entrar con GitHub. Intenta de nuevo.',
    );
  });
});
