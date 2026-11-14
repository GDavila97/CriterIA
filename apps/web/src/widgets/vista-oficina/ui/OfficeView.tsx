'use client';

import { memo, useState, type CSSProperties } from 'react';

import { AGENT_IDS, AGENTS, runHeadline, type AgentId, type RunState } from '@/entities/corrida';
import { ApprovalPanel } from '@/features/aprobar-historias';
import type { RespuestaHumana } from '@/shared/api';
import { usePageVisible, useReducedMotion } from '@/shared/lib/react';
import { Button, Drawer, Ficha } from '@/shared/ui';

import { iso, SCENE, toPercent, VIEW, ZONE_LABELS, type Point3 } from '../model/layout';
import { WALK_SPEED, type Activity, type Facing } from '../model/life';
import { DESKS, placeById, REST, screenDistance } from '../model/places';
import { projectOffice, type AgentPlan, type Globo } from '../model/projection';
import styles from './OfficeView.module.css';
import { useOfficeLife } from './useOfficeLife';

export interface OfficeViewProps {
  state: RunState;
  /** The person's name; the Analyst calls them by the first one on their turn. */
  userName?: string | null;
  onOpenAgent?: (id: AgentId) => void;
  /** Present while a live run can be answered. */
  approval?: { busy: boolean; onAnswer: (respuesta: RespuestaHumana) => void };
  /** Fixes the agents' routine, for tests and screenshots. */
  seed?: number;
}

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

const screenX = (point: Point3) => iso(point)[0];

/** What a free agent is doing, for its button's label. */
const ROUTINE: Record<Activity, string> = {
  escritorio: 'trabajando en su escritorio',
  descanso: 'en la sala de descanso',
  juntas: 'en la sala de juntas',
  tablero: 'revisando el tablero',
  charla: 'platicando',
  celebrar: 'celebrando',
  fijo: '',
};

/** Walks a route one segment at a time at a steady speed, easing in at the start and out at the end. */
function useWalk(route: readonly Point3[], walk: number, reduced: boolean) {
  const [progress, setProgress] = useState({ walk, segment: 0 });
  let segment = progress.segment;
  if (progress.walk !== walk) {
    setProgress({ walk, segment: 0 });
    segment = 0;
  }
  const last = route.length - 1;
  const walking = !reduced && segment < last;
  const from = route[walking ? segment : last]!;
  const to = route[walking ? segment + 1 : last]!;
  const easing =
    last === 1
      ? 'ease-in-out'
      : segment === 0
        ? 'ease-in'
        : segment === last - 1
          ? 'ease-out'
          : 'linear';
  return {
    to,
    walking,
    duration: walking ? (screenDistance(from, to) / WALK_SPEED) * 1000 : 0,
    easing,
    facing: walking ? (screenX(to) >= screenX(from) ? 'derecha' : 'izquierda') : null,
    next: () =>
      setProgress((current) =>
        current.walk === walk ? { walk, segment: current.segment + 1 } : current,
      ),
  } as const;
}

interface AgentProps {
  id: AgentId;
  index: number;
  plan: AgentPlan;
  actividad: string;
  route: readonly Point3[];
  walk: number;
  facing: Facing;
  bubble: Globo | null;
  /** True while the agent says a chat line, for its small gesture. */
  speaking: boolean;
  trabajando: boolean;
  reduced: boolean;
  onOpen?: (id: AgentId) => void;
}

function OfficeAgent({
  id,
  index,
  plan,
  actividad,
  route,
  walk,
  facing,
  bubble,
  speaking,
  trabajando,
  reduced,
  onOpen,
}: AgentProps) {
  const info = AGENTS[id];
  const step = useWalk(route, walk, reduced);
  const at = toPercent(step.to);
  const style = {
    transform: `translate(${at.x}%, ${at.y}%)`,
    transitionDuration: `${Math.round(step.duration)}ms`,
    transitionTimingFunction: step.easing,
    zIndex: Math.round(at.y * 10),
    // Each agent breathes and blinks on its own beat.
    '--desfase': `${-index * 0.9}s`,
    '--respira': `${3 + index * 0.3}s`,
    '--ficha-desfase': `${-index * 1.7}s`,
  } as CSSProperties;

  return (
    <div
      className={styles.slot}
      style={style}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) step.next();
      }}
      data-agent={id}
      data-walking={step.walking || undefined}
    >
      <div className={styles.agent}>
        {bubble && <Bubble key={bubble.texto} globo={bubble} />}
        <button
          type="button"
          className={styles.figure}
          aria-label={`${info.nombre}: ${actividad}, abrir panel`}
          onClick={() => onOpen?.(id)}
        >
          <span className={styles.feet}>
            <span className={styles.shadow} aria-hidden="true" />
            <span
              key={speaking ? bubble?.texto : 'quieto'}
              className={speaking ? styles.say : undefined}
            >
              <span
                key={walk}
                className={step.walking ? styles.bounce : walk ? styles.settle : undefined}
              >
                <span className={step.walking ? undefined : styles.shift}>
                  <span className={step.walking ? undefined : styles.breathe}>
                    <Ficha
                      color={info.color}
                      shadow={info.sombra}
                      size={44}
                      rol={info.icono}
                      patas
                      papeles={plan.papeles}
                      trabajando={trabajando && !step.walking}
                      andar={step.walking}
                      mirar={step.facing ?? facing}
                    />
                  </span>
                </span>
              </span>
            </span>
          </span>
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
  const fixed = Object.fromEntries(
    AGENT_IDS.flatMap((id) => {
      const lugar = office.agentes[id].lugar;
      return lugar ? [[id, lugar]] : [];
    }),
  ) as Partial<Record<AgentId, string>>;
  const life = useOfficeLife(
    { fixed, celebrate: office.celebrar },
    { seed, active: visible && !reduced },
  );
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
          {AGENT_IDS.map((id, index) => {
            const plan = office.agentes[id];
            const own = life[id];
            // With reduced motion nobody walks: each agent simply stands where it belongs.
            const still = plan.lugar
              ? placeById(plan.lugar)
              : office.celebrar
                ? REST[index]!
                : DESKS[id];
            const route = reduced ? [still.point] : own.route;
            const celebrating = reduced ? office.celebrar : own.activity === 'celebrar';
            const fixedBubble = plan.libre ? (celebrating ? plan.globo : null) : plan.globo;
            const said = reduced ? null : own.bubble;
            return (
              <OfficeAgent
                key={id}
                id={id}
                index={index}
                plan={plan}
                actividad={
                  plan.libre && !reduced && own.activity !== 'fijo'
                    ? ROUTINE[own.activity]
                    : plan.actividad
                }
                route={route}
                walk={reduced ? 0 : own.walk}
                facing={reduced ? 'derecha' : own.facing}
                bubble={fixedBubble ?? (said ? { texto: said, tono: 'normal' } : null)}
                speaking={Boolean(said) && own.activity === 'charla'}
                trabajando={plan.trabajando || (!reduced && own.activity === 'escritorio')}
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
