'use client';

import { useId, useState, type ReactNode } from 'react';

import { Ficha, motion } from '@/shared/ui';

import { AGENTS, isAgentId } from '../model/agents';
import {
  conversationSummary,
  filterMessages,
  isCorrection,
  type Listener,
  type MessageFilter,
  type TeamMessage,
} from '../model/conversation';
import type { ArtifactRef } from '../model/refs';
import { formatClock } from '../model/selectors';

import styles from './TeamConversation.module.css';

const FILTERS: { id: MessageFilter; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'correcciones', label: 'Correcciones' },
  { id: 'entregas', label: 'Entregas' },
  { id: 'aprobacion', label: 'Tu aprobación' },
];

/** How many messages the live list keeps in view before "Ver toda la conversación". */
export const LIVE_MESSAGES = 4;

export function speakerName(who: Listener): string {
  if (who === 'tu') return 'Tú';
  if (who === 'equipo') return 'Equipo';
  return AGENTS[who].nombre;
}

export function SpeakerMark({ who, size = 28 }: { who: Listener; size?: number }) {
  if (isAgentId(who)) {
    const info = AGENTS[who];
    return <Ficha color={info.color} shadow={info.sombra} size={size} rol={info.icono} />;
  }
  return (
    <span className={styles.you} style={{ width: size + 4, height: size + 4 }} aria-hidden="true">
      Tú
    </span>
  );
}

const inkClass = (who: Listener) => (isAgentId(who) ? styles[`ink-${who}`] : styles.inkNeutral);

function Message({
  message,
  start,
  onOpen,
}: {
  message: TeamMessage;
  start: string | null;
  onOpen: (target: ArtifactRef) => void;
}) {
  return (
    <li className={`${styles.message} ${motion.enter}`}>
      <div className={styles.rail}>
        <SpeakerMark who={message.from} />
        <span className={styles.line} aria-hidden="true" />
      </div>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={`${styles.who} ${inkClass(message.from)}`}>
            {speakerName(message.from)}
          </span>
          {message.to && (
            <>
              <span className={styles.arrow} aria-label="para">
                →
              </span>
              <span className={`${styles.who} ${inkClass(message.to)}`}>
                {speakerName(message.to)}
              </span>
            </>
          )}
          {isCorrection(message) && (
            <span className={styles.fix}>
              {message.kind === 'pendiente' ? 'Pendiente' : 'Corrección'}
            </span>
          )}
          {message.ronda > 0 && <span className={styles.round}>Ronda {message.ronda + 1}</span>}
          {start && <span className={styles.time}>{formatClock(start, message.ts)}</span>}
        </div>
        <p className={styles.text}>{message.text}</p>
        {message.refs.length > 0 && (
          <div className={styles.refs}>
            {message.refs.map((target) => (
              <button
                key={`${target.kind}-${target.id}`}
                type="button"
                className={styles.ref}
                aria-label={`Ver ${target.label}`}
                onClick={() => onOpen(target)}
              >
                {target.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export interface TeamConversationProps {
  messages: readonly TeamMessage[];
  /** The analysis start, for each message's time. */
  start: string | null;
  onOpen: (target: ArtifactRef) => void;
  /**
   * full: every message with filters. collapsed: only the corrections until asked.
   * live: the latest messages while the analysis runs.
   */
  mode?: 'full' | 'collapsed' | 'live';
  /** Extra controls beside the title, such as the list and diagram switch. */
  tools?: ReactNode;
  /** Replaces the list, as the diagram does. */
  children?: ReactNode;
}

export function TeamConversation({
  messages,
  start,
  onOpen,
  mode = 'full',
  tools,
  children,
}: TeamConversationProps) {
  const titleId = useId();
  const [expanded, setExpanded] = useState(mode === 'full');
  const [filter, setFilter] = useState<MessageFilter>('todo');
  const corrections = messages.filter(isCorrection);

  const shown = expanded
    ? filterMessages(messages, filter)
    : mode === 'collapsed'
      ? corrections
      : messages.slice(-LIVE_MESSAGES);
  const hidden = messages.length - shown.length;

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.top}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
            Así trabajó el equipo
          </h2>
          <p className={styles.lead}>
            {mode === 'live'
              ? 'Lo que se piden y entregan los agentes, en vivo.'
              : 'Lo que se pidieron y entregaron los agentes durante este análisis, en orden.'}
          </p>
        </div>
        <p className={styles.summary}>{conversationSummary(messages)}</p>
        {tools}
      </div>
      {children ?? (
        <>
          {expanded && (
            <div role="group" aria-label="Filtrar mensajes" className={styles.filters}>
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.filter}
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {shown.length ? (
            <div role={mode === 'live' ? 'log' : undefined}>
              <ol className={styles.list}>
                {shown.map((message) => (
                  <Message key={message.id} message={message} start={start} onOpen={onOpen} />
                ))}
              </ol>
            </div>
          ) : (
            <p className={styles.empty}>
              {!expanded && mode === 'collapsed'
                ? 'El Revisor no pidió correcciones.'
                : messages.length
                  ? 'Ningún mensaje de este tipo.'
                  : 'Los mensajes del equipo aparecen aquí en cuanto empiezan.'}
            </p>
          )}
          {!expanded && hidden > 0 && (
            <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
              Ver toda la conversación ({messages.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}
