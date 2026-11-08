'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { promedio } from '@/entities/corrida';
import { DataControls } from '@/features/controles-datos';
import { api, ApiError, type HistorySummaryBody, type Puntaje } from '@/shared/api';
import { modelLabel } from '@/shared/config/providers';
import { motion, Notice, SkeletonCard } from '@/shared/ui';
import { Header, type HeaderUser } from '@/widgets/encabezado';

import styles from './HistoryPage.module.css';

const DATE = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

export function HistoryPage({
  user,
  client = api,
}: {
  user: HeaderUser;
  client?: Pick<typeof api, 'history'>;
}) {
  const [items, setItems] = useState<HistorySummaryBody[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .history()
      .then(setItems)
      .catch((failure: unknown) =>
        setError(failure instanceof ApiError ? failure.message : 'No se pudo cargar tu historial.'),
      );
  }, [client]);

  return (
    <div className={styles.page}>
      <Header user={user} />
      <main className={styles.main}>
        <h1 className={styles.title}>Historial</h1>
        <p className={styles.lead}>
          Solo aparecen las corridas que guardaste. Activa &quot;Guardar mis corridas&quot; en{' '}
          <Link href="/ajustes/historial">Ajustes</Link> o elige guardarla al ejecutar.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {items === null && !error && <SkeletonCard lines={3} label="Cargando tu historial" />}
        {items?.length === 0 && <p className={styles.lead}>Aún no tienes corridas guardadas.</p>}
        {items && items.length > 0 && (
          <ul className={styles.list}>
            {items.map((item) => {
              const media = promedio(item.scores as unknown as Puntaje[]);
              return (
                <li key={item.id}>
                  <Link href={`/historial/${item.id}`} className={`${styles.item} ${motion.lift}`}>
                    <span>
                      <strong>{DATE.format(new Date(item.created_at))}</strong>
                      <br />
                      <span className={styles.meta}>
                        {modelLabel(item.provider, item.model_display_name)} ·{' '}
                        {item.status === 'completada' ? 'Terminada' : 'Con error'}
                      </span>
                    </span>
                    <span className={styles.score}>
                      {media === null ? '—' : `${media.toFixed(1)}/5`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <section className={styles.card} aria-label="Borrar historial">
          <DataControls show={['historial']} />
        </section>
      </main>
    </div>
  );
}
