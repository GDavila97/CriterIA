'use client';

import type { RunState } from '@/entities/corrida';
import { Button } from '@/shared/ui';

import { download, toJson, toMarkdown } from '../model/export';

export function ExportButtons({
  state,
  requerimiento,
}: {
  state: RunState;
  requerimiento: string;
}) {
  const name = `criteria-${(state.runId ?? 'corrida').slice(0, 8)}`;
  return (
    <>
      <Button
        small
        onClick={() => download(`${name}.md`, toMarkdown(state, requerimiento), 'text/markdown')}
      >
        Exportar Markdown
      </Button>
      <Button
        small
        onClick={() => download(`${name}.json`, toJson(state, requerimiento), 'application/json')}
      >
        JSON
      </Button>
    </>
  );
}
