'use client';

import { useEffect, useState } from 'react';

import { api, type EvaluationBatchBody } from '@/shared/api';
import { Notice } from '@/shared/ui';
import { Header, type HeaderUser } from '@/widgets/encabezado';
import { EvaluationBoard } from '@/widgets/tablero-evaluacion';

import styles from './EvaluationPage.module.css';

export function EvaluationPage({
  user,
  client = api,
}: {
  user: HeaderUser | null;
  client?: Pick<typeof api, 'evaluation'>;
}) {
  const [lotes, setLotes] = useState<EvaluationBatchBody[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    client
      .evaluation()
      .then((body) => setLotes(body.lotes))
      .catch(() => setError(true));
  }, [client]);

  return (
    <div className={styles.page}>
      <Header user={user} />
      <main className={styles.main}>
        {error && (
          <Notice tone="error">No se pudieron cargar los resultados. Intenta más tarde.</Notice>
        )}
        {lotes === null && !error && <p className={styles.loading}>Cargando…</p>}
        {lotes && <EvaluationBoard lotes={lotes} />}
      </main>
    </div>
  );
}
