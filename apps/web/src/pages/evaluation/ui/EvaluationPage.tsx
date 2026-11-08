'use client';

import { useEffect, useState } from 'react';

import { api, type EvaluationBody } from '@/shared/api';
import { Notice, SkeletonCard } from '@/shared/ui';
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
  const [body, setBody] = useState<EvaluationBody | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    client
      .evaluation()
      .then(setBody)
      .catch(() => setError(true));
  }, [client]);

  return (
    <div className={styles.page}>
      <Header user={user} />
      <main className={styles.main}>
        {error && (
          <Notice tone="error">No se pudieron cargar los resultados. Intenta más tarde.</Notice>
        )}
        {body === null && !error && <SkeletonCard lines={4} label="Cargando resultados" />}
        {body && <EvaluationBoard lotes={body.lotes} acuerdo={body.acuerdo_juez} />}
      </main>
    </div>
  );
}
