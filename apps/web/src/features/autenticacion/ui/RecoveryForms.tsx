'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { authClient } from '@/shared/lib/auth/client';
import { useHydrated } from '@/shared/lib/react';
import { Button, Notice, TextField } from '@/shared/ui';

import { authErrorMessage } from '../model/messages';

import styles from './AuthCard.module.css';

/** Asks for a reset link; the answer never says whether the account exists. */
export function RecoverForm() {
  const hydrated = useHydrated();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get('email') ?? '').trim(),
      redirectTo: '/restablecer',
    });
    setBusy(false);
    setSent(true);
  };

  return (
    <section className={styles.card} aria-labelledby="recover-title">
      <h1 id="recover-title" className={styles.title}>
        Recupera tu contraseña
      </h1>
      {sent ? (
        <Notice tone="ok" live>
          Si hay una cuenta con ese correo, te enviamos un enlace para elegir otra contraseña.
        </Notice>
      ) : (
        <form className={styles.form} onSubmit={submit} method="post">
          <TextField label="Correo" name="email" type="email" autoComplete="email" required />
          <Button type="submit" variant="primary" block disabled={busy || !hydrated}>
            Enviar enlace
          </Button>
        </form>
      )}
      <Link href="/" className={styles.link}>
        Volver al inicio
      </Link>
    </section>
  );
}

export function ResetForm({ token }: { token: string | null }) {
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : authErrorMessage({ code: 'INVALID_TOKEN' }),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get('password') ?? '');
    if (newPassword.length < 12) {
      setError(authErrorMessage({ code: 'PASSWORD_TOO_SHORT' }));
      return;
    }
    const { error: failure } = await authClient.resetPassword({ newPassword, token: token ?? '' });
    if (failure) setError(authErrorMessage(failure));
    else setDone(true);
  };

  return (
    <section className={styles.card} aria-labelledby="reset-title">
      <h1 id="reset-title" className={styles.title}>
        Elige una contraseña nueva
      </h1>
      {error && <Notice tone="error">{error}</Notice>}
      {done ? (
        <Notice tone="ok" live>
          Tu contraseña cambió. Ya puedes entrar con ella.
        </Notice>
      ) : (
        token && (
          <form className={styles.form} onSubmit={submit} method="post">
            <TextField
              label="Contraseña nueva"
              name="password"
              type="password"
              autoComplete="new-password"
              hint="Mínimo 12 caracteres"
              required
              minLength={12}
            />
            <Button type="submit" variant="primary" block disabled={!hydrated}>
              Guardar contraseña
            </Button>
          </form>
        )
      )}
      <Link href="/" className={styles.link}>
        Volver al inicio
      </Link>
    </section>
  );
}
