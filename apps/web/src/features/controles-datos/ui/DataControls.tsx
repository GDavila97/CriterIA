'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, apiToken, ApiError } from '@/shared/api';
import { authClient } from '@/shared/lib/auth/client';
import { Button, Notice } from '@/shared/ui';

import styles from './DataControls.module.css';

export type DataControl = 'historial' | 'claves' | 'cuenta';

export interface DataControlsProps {
  show?: DataControl[];
  client?: Pick<typeof api, 'clearHistory' | 'credentials' | 'deleteCredential'>;
}

/** Deletion controls; deleting the account removes every row of the person through the API's foreign keys. */
export function DataControls({
  show = ['historial', 'claves', 'cuenta'],
  client = api,
}: DataControlsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: 'ok', text: await action() });
    } catch (failure) {
      setMessage({
        tone: 'error',
        text: failure instanceof ApiError ? failure.message : 'No se pudo completar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = () =>
    run(async () => {
      const { deleted } = await client.clearHistory();
      return deleted
        ? `Borramos ${deleted} análisis de tu historial.`
        : 'Tu historial ya estaba vacío.';
    });

  const deleteKeys = () =>
    run(async () => {
      const keys = await client.credentials();
      await Promise.all(keys.map((key) => client.deleteCredential(key.proveedor)));
      return keys.length ? 'Eliminamos tus claves.' : 'No tenías claves guardadas.';
    });

  const deleteAccount = async () => {
    setBusy(true);
    const { error } = await authClient.deleteUser();
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: 'No se pudo eliminar la cuenta. Vuelve a entrar e intenta de nuevo.',
      });
      return;
    }
    apiToken.clear();
    router.push('/?cuenta=eliminada');
    router.refresh();
  };

  return (
    <div className={styles.controls}>
      {message && (
        <Notice tone={message.tone} live>
          {message.text}
        </Notice>
      )}
      <div className={styles.row}>
        {show.includes('historial') && (
          <Button onClick={clearHistory} disabled={busy}>
            Borrar mi historial
          </Button>
        )}
        {show.includes('claves') && (
          <Button onClick={deleteKeys} disabled={busy}>
            Eliminar mis claves
          </Button>
        )}
        {show.includes('cuenta') && (
          <Button
            variant="danger"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-expanded={confirming}
          >
            Eliminar mi cuenta
          </Button>
        )}
      </div>
      {show.includes('cuenta') && confirming && (
        <div
          className={styles.confirm}
          role="group"
          aria-label="Confirmar eliminación de la cuenta"
        >
          <p className={styles.note}>
            Se borran tu cuenta, tus claves, tu uso y tu historial. No se puede deshacer.
          </p>
          <div className={styles.row}>
            <Button variant="danger" onClick={deleteAccount} disabled={busy}>
              Sí, eliminar mi cuenta
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancelar</Button>
          </div>
        </div>
      )}
      {show.includes('cuenta') && (
        <p className={styles.note}>
          Eliminar tu cuenta borra todo lo anterior de forma permanente.
        </p>
      )}
    </div>
  );
}
