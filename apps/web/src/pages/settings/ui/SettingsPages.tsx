'use client';

import { useEffect, useState } from 'react';

import { DataControls } from '@/features/controles-datos';
import { ModelsAndKeys } from '@/features/gestionar-claves';
import { api, ApiError, type SettingsBody } from '@/shared/api';
import { CheckboxField, Notice } from '@/shared/ui';
import type { HeaderUser } from '@/widgets/encabezado';

import { SettingsLayout } from './SettingsLayout';
import styles from './SettingsLayout.module.css';

export interface AccountUser extends HeaderUser {
  providers: string[];
}

export function ModelsSettingsPage({ user }: { user: HeaderUser }) {
  return (
    <SettingsLayout
      user={user}
      title="Modelos y claves"
      lead="Elige con qué modelos trabajan los agentes. El modo gratuito no necesita clave. Para modelos de pago conecta tu propia clave: el costo se cobra a tu cuenta del proveedor, nunca a CriterIA."
    >
      <ModelsAndKeys />
    </SettingsLayout>
  );
}

const METHODS: Record<string, string> = {
  credential: 'Correo y contraseña',
  github: 'GitHub',
  google: 'Google',
};

export function AccountSettingsPage({ user }: { user: AccountUser }) {
  return (
    <SettingsLayout user={user} title="Cuenta">
      <section className={styles.card} aria-labelledby="account-title">
        <h2 id="account-title" className={styles.cardTitle}>
          Tus datos
        </h2>
        <dl className={styles.facts}>
          <dt>Nombre</dt>
          <dd>{user.name || '—'}</dd>
          <dt>Correo</dt>
          <dd>{user.email}</dd>
          <dt>Entras con</dt>
          <dd>{user.providers.map((p) => METHODS[p] ?? p).join(', ') || '—'}</dd>
        </dl>
      </section>
      <section className={styles.card} aria-labelledby="delete-title">
        <h2 id="delete-title" className={styles.cardTitle}>
          Eliminar la cuenta
        </h2>
        <DataControls show={['cuenta']} />
      </section>
    </SettingsLayout>
  );
}

export function HistorySettingsPage({
  user,
  client = api,
}: {
  user: HeaderUser;
  client?: Pick<typeof api, 'settings' | 'saveSettings'>;
}) {
  const [settings, setSettings] = useState<SettingsBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .settings()
      .then(setSettings)
      .catch(() => setError('No se pudieron cargar tus ajustes.'));
  }, [client]);

  const toggle = async (save: boolean) => {
    if (!settings) return;
    try {
      setSettings(await client.saveSettings({ ...settings, save_history: save }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'No se guardó el cambio.');
    }
  };

  return (
    <SettingsLayout
      user={user}
      title="Historial"
      lead="Tus corridas no se guardan a menos que lo actives. Puedes elegirlo también en cada corrida."
    >
      {error && <Notice tone="error">{error}</Notice>}
      <section className={styles.card} aria-labelledby="history-title">
        <h2 id="history-title" className={styles.cardTitle}>
          Guardar mis corridas
        </h2>
        <CheckboxField
          label="Guardar mis corridas por defecto"
          checked={settings?.save_history ?? false}
          disabled={!settings}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <DataControls show={['historial']} />
      </section>
    </SettingsLayout>
  );
}
