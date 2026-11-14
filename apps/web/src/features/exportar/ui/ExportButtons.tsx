'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { RunState } from '@/entities/corrida';
import { Button, Icon } from '@/shared/ui';

import { download, toJson, toMarkdown } from '../model/export';
import styles from './ExportButtons.module.css';

const fileName = (state: RunState) => `criteria-${(state.runId ?? 'analisis').slice(0, 8)}`;

export function downloadMarkdown(state: RunState, requerimiento: string) {
  download(`${fileName(state)}.md`, toMarkdown(state, requerimiento), 'text/markdown');
}

function downloadJson(state: RunState, requerimiento: string) {
  download(`${fileName(state)}.json`, toJson(state, requerimiento), 'application/json');
}

function DownloadMenu({ state, requerimiento }: { state: RunState; requerimiento: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const choose = (save: (s: RunState, r: string) => void) => {
    save(state, requerimiento);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className={styles.menu} ref={root}>
      <Button
        ref={trigger}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="descargar" size={18} />
        Descargar
        <Icon name="abajo" size={16} />
      </Button>
      {open && (
        <ul id={menuId} className={styles.options} aria-label="Formato de descarga">
          <li>
            <button type="button" onClick={() => choose(downloadMarkdown)}>
              Markdown
            </button>
          </li>
          <li>
            <button type="button" onClick={() => choose(downloadJson)}>
              JSON
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export interface ResultActionsProps {
  state: RunState;
  requerimiento: string;
  /** Finished without history: downloading is the only way to keep it. */
  unsaved?: boolean;
  /** Clears the form and the result; absent when viewing a saved analysis. */
  onNewAnalysis?: () => void;
}

/** What can be done with a finished analysis: keep it, or start the next one. */
export function ResultActions({
  state,
  requerimiento,
  unsaved = false,
  onNewAnalysis,
}: ResultActionsProps) {
  return (
    <div className={styles.bar}>
      {unsaved && <p className={styles.unsaved}>No guardado en tu historial</p>}
      <div className={styles.row}>
        <DownloadMenu state={state} requerimiento={requerimiento} />
        {onNewAnalysis && (
          <Button variant="primary" onClick={onNewAnalysis}>
            <Icon name="mas" size={18} />
            Nuevo análisis
          </Button>
        )}
      </div>
    </div>
  );
}
