'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { authClient } from '@/shared/lib/auth/client';
import { useHydrated } from '@/shared/lib/react';
import { Button, Notice, Segmented, TextField } from '@/shared/ui';

import { authErrorMessage, oauthErrorMessage } from '../model/messages';

import styles from './AuthCard.module.css';

export type EmailMode = 'none' | 'smtp' | 'resend';
type Mode = 'crear' | 'entrar';

export interface AuthCardProps {
  githubEnabled: boolean;
  emailMode: EmailMode;
  oauthError?: string | null;
}

const MIN_PASSWORD = 12;
const AFTER_SIGN_IN = '/corrida';

export function AuthCard({ githubEnabled, emailMode, oauthError }: AuthCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('crear');
  const [error, setError] = useState<string | null>(oauthErrorMessage(oauthError));
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sendsEmail = emailMode !== 'none';
  const hydrated = useHydrated();

  const github = async () => {
    setBusy(true);
    const { error: failure } = await authClient.signIn.social({
      provider: 'github',
      callbackURL: AFTER_SIGN_IN,
      errorCallbackURL: '/',
    });
    if (failure) {
      setError(authErrorMessage(failure));
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (password.length < MIN_PASSWORD) {
      setError(authErrorMessage({ code: 'PASSWORD_TOO_SHORT' }));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: failure } =
      mode === 'crear'
        ? await authClient.signUp.email({
            name: String(data.get('name') ?? '').trim(),
            email,
            password,
            callbackURL: AFTER_SIGN_IN,
          })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (failure) {
      setError(authErrorMessage(failure));
      return;
    }
    if (mode === 'crear' && sendsEmail) {
      setSent(true);
      return;
    }
    router.push(AFTER_SIGN_IN);
    router.refresh();
  };

  return (
    <section className={styles.card} aria-labelledby="auth-title">
      <div className={styles.switch}>
        <Segmented<Mode>
          label="Acceso"
          value={mode}
          onChange={(value) => {
            setMode(value);
            setError(null);
            setSent(false);
          }}
          options={[
            { value: 'crear', label: 'Crear cuenta' },
            { value: 'entrar', label: 'Iniciar sesión' },
          ]}
        />
      </div>
      <h2 id="auth-title" className={styles.title}>
        {mode === 'crear' ? 'Crea tu cuenta' : 'Entra a tu cuenta'}
      </h2>
      {githubEnabled && (
        <>
          <Button variant="secondary" block onClick={github} disabled={busy || !hydrated}>
            Continuar con GitHub
          </Button>
          <p className={styles.separator}>o con tu correo</p>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {sent ? (
        <Notice tone="ok" live>
          Te enviamos un correo para verificar tu cuenta. Abre el enlace para entrar.
        </Notice>
      ) : (
        <form className={styles.form} onSubmit={submit} method="post">
          {mode === 'crear' && (
            <TextField label="Nombre" name="name" autoComplete="name" required maxLength={80} />
          )}
          <TextField label="Correo" name="email" type="email" autoComplete="email" required />
          <TextField
            label="Contraseña"
            name="password"
            type="password"
            autoComplete={mode === 'crear' ? 'new-password' : 'current-password'}
            hint={mode === 'crear' ? 'Mínimo 12 caracteres' : undefined}
            required
            minLength={MIN_PASSWORD}
          />
          <Button type="submit" variant="primary" block disabled={busy || !hydrated}>
            {mode === 'crear' ? 'Crear cuenta' : 'Entrar'}
          </Button>
          {mode === 'entrar' && sendsEmail && (
            <Link href="/recuperar" className={styles.link}>
              ¿Olvidaste tu contraseña?
            </Link>
          )}
        </form>
      )}
      {mode === 'crear' && (
        <p className={styles.note}>
          {sendsEmail
            ? 'Te enviaremos un correo para verificar tu cuenta antes de tu primera corrida.'
            : 'Por ahora no hay recuperación de contraseña. Guárdala en un lugar seguro.'}
        </p>
      )}
    </section>
  );
}
