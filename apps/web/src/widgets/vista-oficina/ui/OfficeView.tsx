'use client';

import { memo, useState, type CSSProperties } from 'react';

import { AGENT_IDS, AGENTS, runHeadline, type AgentId, type RunState } from '@/entities/corrida';
import { ApprovalPanel } from '@/features/aprobar-historias';
import type { RespuestaHumana } from '@/shared/api';
import { usePageVisible, useReducedMotion } from '@/shared/lib/react';
import { Button, Drawer, Ficha } from '@/shared/ui';

import {
  HOME_REST,
  iso,
  REST_SPOTS,
  SCENE,
  toPercent,
  VIEW,
  ZONE_LABELS,
  type Point3,
} from '../model/layout';
import { projectOffice, type AgentPlan, type Globo } from '../model/projection';
import styles from './OfficeView.module.css';
import { useIdleLife } from './useIdleLife';

export interface OfficeViewProps {
  state: RunState;
  /** The person's name; the Analyst calls them by the first one on their turn. */
  userName?: string | null;
  onOpenAgent?: (id: AgentId) => void;
  /** Present while a live run can be answered. */
  approval?: { busy: boolean; onAnswer: (respuesta: RespuestaHumana) => void };
  /** Fixes the free agents' wandering, for tests and screenshots. */
  seed?: number;
}

const WALK_MS_PER_PERCENT = 45;

/** The room itself: drawn once and hidden from assistive technology. */
const OfficeScene = memo(function OfficeScene() {
  return (
    <svg
      className={styles.scene}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {SCENE.map((shape, i) => (
        <polygon key={i} points={shape.points} fill={shape.fill} />
      ))}
      {Object.values(ZONE_LABELS).map(({ label, at }) => {
        const [x, y] = iso(at);
        const width = label.length * 9.6 + 28;
        return (
          <g key={label} transform={`translate(${x} ${y})`}>
            <rect
              x={-width / 2}
              y={-17}
              width={width}
              height={34}
              rx={17}
              fill="#ffffff"
              stroke="#dde1e7"
            />
            <text className={styles.zoneLabel} textAnchor="middle" dy="6">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

function Bubble({ globo }: { globo: Globo }) {
  const tone =
    globo.tono === 'turno' ? styles.bubbleTurn : globo.tono === 'error' ? styles.bubbleError : '';
  // The button's label already says what the agent is doing; the bubble only shows it.
  return (
    <span className={`${styles.bubble} ${tone}`} aria-hidden="true">
      {globo.texto}
    </span>
  );
}

interface AgentProps {
  id: AgentId;
  plan: AgentPlan;
  point: Point3;
  bubble: Globo | null;
  reduced: boolean;
  onOpen?: (id: AgentId) => void;
}

function OfficeAgent({ id, plan, point, bubble, reduced, onOpen }: AgentProps) {
  const info = AGENTS[id];
  const target = toPercent(point);
  const key = `${target.x.toFixed(2)},${target.y.toFixed(2)}`;
  const [arrived, setArrived] = useState(key);
  const [from, setFrom] = useState(target);
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  // Walking lasts while the slot travels; with reduced motion, or no real distance, it just arrives.
  const walking = !reduced && arrived !== key && distance >= 0.5;
  if (!walking && arrived !== key) setArrived(key);
  if (!walking && (from.x !== target.x || from.y !== target.y)) setFrom(target);
  const style: CSSProperties = {
    transform: `translate(${target.x}%, ${target.y}%)`,
    transitionDuration: reduced ? '0ms' : `${Math.round(distance * WALK_MS_PER_PERCENT)}ms`,
    zIndex: Math.round(target.y * 10),
  };

  return (
    <div
      className={styles.slot}
      style={style}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setArrived(key);
      }}
      data-agent={id}
      data-walking={walking || undefined}
    >
      <div className={styles.agent}>
        {bubble && <Bubble globo={bubble} />}
        <button
          type="button"
          className={styles.figure}
          aria-label={`${info.nombre}: ${plan.actividad}, abrir panel`}
          onClick={() => onOpen?.(id)}
        >
          <Ficha
            color={info.color}
            shadow={info.sombra}
            size={44}
            rol={info.icono}
            patas
            papeles={plan.papeles}
            trabajando={plan.trabajando}
            andar={walking}
          />
          <span className={styles.name}>{info.nombre}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The same analysis as the classic view, staged as an office: the agents walk to the zone of
 * what they are doing, call the person on their turn and rest when they finish.
 */
export function OfficeView({
  state,
  userName = null,
  onOpenAgent,
  approval,
  seed = 2026,
}: OfficeViewProps) {
  const office = projectOffice(state, userName);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const free = AGENT_IDS.filter((id) => office.agentes[id].libre);
  // Agents resting without wandering, like the Evaluator at the end, keep their place taken.
  const fixed = AGENT_IDS.filter(
    (id) => office.agentes[id].zona === 'descanso' && !office.agentes[id].libre,
  ).map((id) => HOME_REST[id]);
  const idle = useIdleLife(free, {
    seed,
    spotCount: REST_SPOTS.length,
    active: visible && !reduced,
    occupied: fixed,
    home: HOME_REST,
  });
  const [reviewing, setReviewing] = useState(false);
  const turn = office.momento === 'tu_turno' && approval;
  const { contadores } = office;

  return (
    <section
      className={`${styles.office} ${visible ? '' : styles.paused}`}
      aria-labelledby="office-title"
    >
      <div className={styles.head}>
        <h2 id="office-title" className={styles.title}>
          Oficina
        </h2>
        <p className={styles.headline}>{runHeadline(state)}</p>
      </div>

      {turn && (
        <div className={styles.turn}>
          <div>
            <p className={styles.turnTitle}>Las historias están listas para tu revisión</p>
            <p className={styles.turnText}>
              El equipo espera tu aprobación para escribir los casos de prueba.
            </p>
          </div>
          <Button variant="primary" onClick={() => setReviewing(true)}>
            Revisar historias
          </Button>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.stage} style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}` }}>
          <OfficeScene />
          {AGENT_IDS.map((id) => {
            const plan = office.agentes[id];
            const spot = reduced ? undefined : idle.spots[id];
            const point = spot === undefined ? plan.punto : REST_SPOTS[spot]!;
            const said = reduced ? undefined : idle.chatter[id];
            return (
              <OfficeAgent
                key={id}
                id={id}
                plan={plan}
                point={point}
                bubble={plan.globo ?? (said ? { texto: said, tono: 'normal' } : null)}
                reduced={reduced}
                onOpen={onOpenAgent}
              />
            );
          })}
        </div>
        <ul className={styles.counters} aria-label="Contadores">
          <li>
            <span className={styles.swatch} data-agent="analista" />
            Historias<span className={styles.value}>{contadores.historias}</span>
          </li>
          <li>
            <span className={styles.swatch} data-agent="qa" />
            Casos de prueba<span className={styles.value}>{contadores.casos}</span>
          </li>
          <li>
            <span className={styles.swatch} data-agent="revisor" />
            Observaciones<span className={styles.value}>{contadores.observaciones}</span>
          </li>
          <li>
            <span className={styles.swatch} data-agent="evaluador" />
            Puntaje<span className={styles.value}>{contadores.puntaje}</span>
          </li>
        </ul>
      </div>

      <p className={styles.log}>
        <strong>Registro:</strong> {office.ultimoEvento}
      </p>
      <p className={styles.hint}>
        Toca un agente para ver su panel. La vista clásica muestra lo mismo sin animación.
      </p>
      <p className="sr-only" aria-live="polite">
        {office.anuncio}
      </p>

      {approval && (
        <Drawer
          open={reviewing && Boolean(turn)}
          title="Revisar historias"
          amplio
          onClose={() => setReviewing(false)}
        >
          <ApprovalPanel
            key={state.ultimoSeq}
            historias={state.historias}
            otrasVersiones={state.otrasVersiones}
            busy={approval.busy}
            onAnswer={(respuesta) => {
              setReviewing(false);
              approval.onAnswer(respuesta);
            }}
          />
        </Drawer>
      )}
    </section>
  );
}
