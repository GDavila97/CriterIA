'use client';

import type { RunState } from '@/entities/corrida';
import { Button, Icon } from '@/shared/ui';

import { download, toJson, toMarkdown } from '../model/export';
import styles from './ExportButtons.module.css';

const fileName = (state: RunState) => `criteria-${(state.runId ?? 'analisis').slice(0, 8)}`;

export function downloadMarkdown(state: RunState, requerimiento: string) {
  download(`${fileName(state)}.md`, toMarkdown(state, requerimiento), 'text/markdown');
}

export function ExportButtons({
  state,
  requerimiento,
  unsaved = false,
}: {
  state: RunState;
  requerimiento: string;
  /** Finished without history: this download is the only way to keep it. */
  unsaved?: boolean;
}) {
  return (
    <>
      {unsaved && (
        <p className={styles.unsaved}>
          <Icon name="alerta" size={16} />
          No guardado en tu historial
        </p>
      )}
      <Button small onClick={() => downloadMarkdown(state, requerimiento)}>
        Exportar Markdown
      </Button>
      <Button
        small
        onClick={() =>
          download(`${fileName(state)}.json`, toJson(state, requerimiento), 'application/json')
        }
      >
        JSON
      </Button>
    </>
  );
}
