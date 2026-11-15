'use client';

import { useState } from 'react';

import { isCorrection, type TeamMessage } from '../model/conversation';
import { DIAGRAM, diagramLayout, relatedSteps } from '../model/diagram';
import type { ArtifactRef } from '../model/refs';
import { formatClock } from '../model/selectors';

import styles from './TeamDiagram.module.css';
import { SpeakerMark, speakerName } from './TeamConversation';

const laneClass = (id: string) => styles[`lane-${id}`] ?? '';

export function TeamDiagram({
  messages,
  start,
  onOpen,
}: {
  messages: readonly TeamMessage[];
  start: string | null;
  onOpen: (target: ArtifactRef) => void;
}) {
  const layout = diagramLayout(messages);
  const [selectedId, setSelectedId] = useState(
    () => (messages.find(isCorrection) ?? messages[0])?.id ?? null,
  );
  const selected = messages.find((m) => m.id === selectedId) ?? messages[0];
  const related = selected ? relatedSteps(messages, selected) : new Set<string>();

  return (
    <div className={styles.diagram}>
      <div className={styles.scroll} tabIndex={0} aria-label="Diagrama del equipo, desplazable">
        <div className={styles.canvas} style={{ width: layout.width, height: layout.height }}>
          {layout.lanes.map((lane, i) => (
            <div
              key={lane.id}
              className={`${styles.lane} ${i % 2 ? styles.laneAlt : ''}`}
              style={{ top: lane.y, height: DIAGRAM.laneHeight }}
            >
              <span className={`${styles.laneName} ${laneClass(lane.id)}`}>
                <SpeakerMark who={lane.id} size={26} />
                {speakerName(lane.id)}
              </span>
            </div>
          ))}
          <svg
            className={styles.edges}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            {layout.edges.map((e) => (
              <g key={e.id} className={e.kind === 'correccion' ? styles.fixEdge : styles.edge}>
                <path d={e.path} fill="none" strokeLinecap="round" />
                <polygon points={e.arrow} />
              </g>
            ))}
          </svg>
          {layout.edges.map(
            (e) =>
              e.label && (
                <span
                  key={e.id}
                  className={styles.fixLabel}
                  style={{ left: e.label.x, top: e.label.y }}
                  aria-hidden="true"
                >
                  corrección
                </span>
              ),
          )}
          {layout.nodes.map((node) => {
            const m = node.message;
            const on = m.id === selected?.id;
            return (
              <div
                key={m.id}
                className={styles.slot}
                style={{
                  left: node.x,
                  top: node.y,
                  width: DIAGRAM.nodeWidth,
                  height: DIAGRAM.nodeHeight,
                }}
              >
                <button
                  type="button"
                  className={`${styles.node} ${laneClass(m.from)} ${related.has(m.id) ? styles.related : ''}`}
                  aria-pressed={on}
                  onClick={() => setSelectedId(m.id)}
                >
                  <span className="sr-only">{speakerName(m.from)}: </span>
                  <span className={styles.nodeTitle}>{m.title}</span>
                  <span className={styles.nodeSub}>{m.sub}</span>
                  {node.round && <span className="sr-only">, ronda {m.ronda + 1}</span>}
                </button>
                {node.round && (
                  <span className={styles.round} aria-hidden="true">
                    {node.round}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.detail} role="region" aria-live="polite" aria-label="Detalle del paso">
        {selected && (
          <>
            <div className={styles.detailHead}>
              <span className={`${styles.detailWho} ${laneClass(selected.from)}`}>
                {speakerName(selected.from)}
                {selected.to ? ` → ${speakerName(selected.to)}` : ''}
              </span>
              <span aria-hidden="true">·</span>
              <span className={styles.detailTitle}>{selected.title}</span>
              {start && (
                <span className={styles.detailTime}>{formatClock(start, selected.ts)}</span>
              )}
            </div>
            <p className={styles.detailText}>{selected.text}</p>
            {selected.refs.length > 0 && (
              <div className={styles.detailRefs}>
                {selected.refs.map((target) => (
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
          </>
        )}
      </div>
    </div>
  );
}
