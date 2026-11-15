'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  analysisTitle,
  formatUsd,
  promedio,
  stateFromHistory,
  type RunState,
} from '@/entities/corrida';
import { DownloadMenu } from '@/features/exportar';
import { api, ApiError, type HistoryItemBody } from '@/shared/api';
import { modelLabel } from '@/shared/config/providers';
import { Button, buttonClass, Dialog, Icon, motion, Notice, SkeletonCard } from '@/shared/ui';
import { Header, type HeaderUser } from '@/widgets/encabezado';
import { ClassicView } from '@/widgets/vista-clasica';

import styles from './HistoryDetailPage.module.css';

const SAVED_AT = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const SAVED_TIME = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });

interface Saved {
  item: HistoryItemBody;
  state: RunState;
  judgeLabel: string;
}

interface Chip {
  label: string;
  value: string;
  color: string;
}

function chips({ item, state }: Saved): Chip[] {
  const media = promedio(state.puntajes);
  return [
    { label: 'Modelo', value: item.model_display_name, color: 'var(--color-accent)' },
    { label: 'Costo', value: formatUsd(state.totales?.costo_usd), color: 'var(--color-muted)' },
    {
      label: 'Historias',
      value: String(state.historias.length),
      color: 'var(--color-agent-analista)',
    },
    { label: 'Casos', value: String(state.casos.length), color: 'var(--color-agent-qa)' },
    {
      label: 'Observaciones',
      value: String(state.observaciones.length),
      color: 'var(--color-agent-revisor)',
    },
    {
      label: 'Puntaje',
      value: media === null ? '—' : media.toFixed(1),
      color: 'var(--color-agent-evaluador)',
    },
  ];
}

function savedAt(iso: string): string {
  const date = new Date(iso);
  return `Guardado el ${SAVED_AT.format(date).replace(/\./g, '')} · ${SAVED_TIME.format(date)}`;
}

export function HistoryDetailPage({
  user,
  runId,
  client = api,
}: {
  user: HeaderUser;
  runId: string;
  client?: Pick<typeof api, 'historyItem' | 'deleteHistoryItem'>;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    client
      .historyItem(runId)
      .then((item) =>
        setSaved({
          item,
          state: stateFromHistory(item),
          judgeLabel: modelLabel(item.judge_model.split(':')[0] ?? '', item.judge_display_name),
        }),
      )
      .catch((failure: unknown) =>
        setError(failure instanceof ApiError ? failure.message : 'No se pudo abrir el análisis.'),
      );
  }, [client, runId]);

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.deleteHistoryItem(runId);
      router.push('/historial');
      router.refresh();
    } catch (failure) {
      setDeleting(false);
      setConfirming(false);
      setDeleteError(
        failure instanceof ApiError ? failure.message : 'No se pudo eliminar el análisis.',
      );
    }
  };

  return (
    <div className={styles.page}>
      <Header user={user} />
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <Link href="/historial" className={`${buttonClass()} ${styles.back}`}>
            <Icon name="atras" size={20} />
            Historial
          </Link>
          {saved?.item.created_at && (
            <span className={styles.savedAt}>{savedAt(saved.item.created_at)}</span>
          )}
          {saved && (
            <div className={styles.toolbarEnd}>
              <DownloadMenu
                state={saved.state}
                requerimiento={saved.item.requirement}
                align="end"
              />
              <Button
                variant="ghost"
                className={styles.delete}
                onClick={() => setConfirming(true)}
                aria-haspopup="dialog"
              >
                <Icon name="basura" size={18} />
                Eliminar
              </Button>
            </div>
          )}
        </div>
        <div className={styles.heading}>
          <h1 className={styles.title}>
            {saved ? analysisTitle(saved.item.requirement) : 'Análisis guardado'}
          </h1>
          {saved && (
            <ul className={`${styles.chips} ${motion.fade}`} aria-label="Resumen del análisis">
              {chips(saved).map((chip) => (
                <li key={chip.label} className={styles.chip}>
                  <span aria-hidden="true" className={styles.chipMark}>
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <rect width="8" height="8" rx="2" fill={chip.color} />
                    </svg>
                  </span>
                  <span className={styles.chipLabel}>{chip.label}</span>
                  <span className={styles.chipValue}>{chip.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {!saved && !error && <SkeletonCard lines={4} label="Cargando el análisis" />}
        {saved && (
          <>
            {deleteError && <Notice tone="error">{deleteError}</Notice>}
            <details className={styles.card} open>
              <summary className={styles.summary}>Requerimiento</summary>
              <p className={styles.lead}>{saved.item.requirement}</p>
            </details>
            <ClassicView
              state={saved.state}
              requerimiento={saved.item.requirement}
              judgeLabel={saved.judgeLabel}
              actions={false}
              conversation="full"
            />
          </>
        )}
      </main>
      <Dialog
        open={confirming}
        title="¿Eliminar este análisis?"
        description="Se borra de tu historial con sus artefactos y cómo trabajó el equipo. No se puede deshacer."
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={remove} aria-disabled={deleting}>
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </>
        }
      />
    </div>
  );
}
