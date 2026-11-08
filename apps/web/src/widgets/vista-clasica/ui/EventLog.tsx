'use client';

import { useState } from 'react';

import { AGENT_IDS, AGENTS, formatClock, type LogEntry, type RunState } from '@/entities/corrida';
import { Button, Drawer, motion, SelectField } from '@/shared/ui';

import styles from './ClassicView.module.css';

export const RECENT_EVENTS = 5;

type Filter = 'todos' | LogEntry['agent'];

function dotColor(agent: LogEntry['agent']): string {
  return agent === 'sistema' ? 'var(--color-muted)' : AGENTS[agent].color;
}

function Timeline({
  entries,
  start,
  label,
}: {
  entries: LogEntry[];
  start: string;
  label: string;
}) {
  return (
    <div role="log" aria-label={label}>
      <ol className={styles.log}>
        {entries.map((entry) => (
          <li key={entry.seq} className={`${styles.logEntry} ${motion.enter}`}>
            <span className={styles.mono}>{formatClock(start, entry.ts)}</span>
            <span className={styles.logDot} aria-hidden="true">
              <svg width="8" height="8" viewBox="0 0 8 8">
                <circle cx="4" cy="4" r="4" fill={dotColor(entry.agent)} />
              </svg>
            </span>
            <span>{entry.texto}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function filterOptions(registro: LogEntry[]) {
  const count = (agent: Filter) =>
    agent === 'todos' ? registro.length : registro.filter((e) => e.agent === agent).length;
  const agents: Filter[] = ['todos', ...AGENT_IDS, 'sistema'];
  const names: Record<Filter, string> = {
    todos: 'Todos los agentes',
    sistema: 'Sistema',
    analista: AGENTS.analista.nombre,
    qa: AGENTS.qa.nombre,
    revisor: AGENTS.revisor.nombre,
    evaluador: AGENTS.evaluador.nombre,
  };
  return agents.map((agent) => ({ value: agent, label: `${names[agent]} (${count(agent)})` }));
}

/**
 * The last events in the card and the whole timeline in a side panel. The panel reads the same
 * live state, so the run keeps streaming while it is open (the stream belongs to this page).
 */
export function EventLog({ state }: { state: RunState }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('todos');
  const start = state.inicio ?? state.registro[0]?.ts;
  const total = state.registro.length;
  const filtered =
    filter === 'todos' ? state.registro : state.registro.filter((e) => e.agent === filter);

  return (
    <section className={styles.card} aria-labelledby="log-title">
      <div className={styles.cardHead}>
        <h2 id="log-title" className={styles.cardTitle}>
          Registro
        </h2>
      </div>
      {total && start ? (
        <Timeline
          entries={state.registro.slice(-RECENT_EVENTS)}
          start={start}
          label="Últimos eventos"
        />
      ) : (
        <p className={styles.empty}>Los eventos aparecen aquí en vivo.</p>
      )}
      {total > RECENT_EVENTS && (
        <Button
          small
          className={styles.logMore}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          Ver registro completo ({total})
        </Button>
      )}
      <Drawer open={open} title="Registro completo" onClose={() => setOpen(false)}>
        {start && (
          <div className={styles.logPanel}>
            <SelectField
              label="Filtrar por agente"
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
              options={filterOptions(state.registro)}
            />
            <p className={styles.logCount}>
              {filtered.length === total
                ? `${total} eventos`
                : `${filtered.length} de ${total} eventos`}
            </p>
            {filtered.length ? (
              <Timeline entries={filtered} start={start} label="Registro completo de la corrida" />
            ) : (
              <p className={styles.empty}>Este agente todavía no tiene eventos.</p>
            )}
          </div>
        )}
      </Drawer>
    </section>
  );
}
