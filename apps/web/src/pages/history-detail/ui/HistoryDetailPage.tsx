'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { stateFromSaved, type RunState } from '@/entities/corrida';
import { api, ApiError } from '@/shared/api';
import { Notice } from '@/shared/ui';
import { Header, type HeaderUser } from '@/widgets/encabezado';
import { ClassicView } from '@/widgets/vista-clasica';

import styles from './HistoryDetailPage.module.css';

export function HistoryDetailPage({
  user,
  runId,
  client = api,
}: {
  user: HeaderUser;
  runId: string;
  client?: Pick<typeof api, 'historyItem'>;
}) {
  const [saved, setSaved] = useState<{ state: RunState; requirement: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .historyItem(runId)
      .then((item) => setSaved({ state: stateFromSaved(item), requirement: item.requirement }))
      .catch((failure: unknown) =>
        setError(failure instanceof ApiError ? failure.message : 'No se pudo abrir la corrida.'),
      );
  }, [client, runId]);

  return (
    <div className={styles.page}>
      <Header user={user} />
      <main className={styles.main}>
        <Link href="/historial" className={styles.back}>
          Volver al historial
        </Link>
        <h1 className={styles.title}>Corrida guardada</h1>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && (
          <>
            <section className={styles.card} aria-label="Requerimiento">
              <p className={styles.lead}>{saved.requirement}</p>
            </section>
            <ClassicView state={saved.state} requerimiento={saved.requirement} />
          </>
        )}
      </main>
    </div>
  );
}
