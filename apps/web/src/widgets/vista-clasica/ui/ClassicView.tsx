'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  AGENT_IDS,
  AGENTS,
  agentSummary,
  anchorOf,
  CRITERIO_LABEL,
  observationLabel,
  promedio,
  REF_TAB,
  runHeadline,
  teamMessages,
  TeamWork,
  type AgentId,
  type ArtifactRef,
  type RunState,
} from '@/entities/corrida';
import { ApprovalPanel } from '@/features/aprobar-historias';
import type { Connection } from '@/features/ejecutar-corrida';
import { ResultActions } from '@/features/exportar';
import type { RespuestaHumana } from '@/shared/api';
import { Button, buttonClass, Ficha, Icon, motion, Tabs } from '@/shared/ui';

import { Casos, Gherkin, Historias, Observaciones, type Reveal } from './Artifacts';
import styles from './ClassicView.module.css';
import { EventLog } from './EventLog';

export interface ClassicViewProps {
  state: RunState;
  requerimiento: string;
  connection?: Connection;
  onOpenAgent?: (id: AgentId) => void;
  /** Present while a live run can be answered. */
  approval?: { busy: boolean; onAnswer: (respuesta: RespuestaHumana) => void };
  /** Offers the free mode after a key failure; it only runs after the click. */
  onUseFree?: () => void;
  /** The judge's readable name, such as "Groq · GPT-OSS 20B". */
  judgeLabel?: string;
  /** Whether the finished analysis went to the history; unknown for saved ones being viewed. */
  saved?: boolean;
  /** Starts over from a finished result; absent when viewing a saved analysis. */
  onNewAnalysis?: () => void;
  /**
   * Takes the place of the agent flow and the event log, as the office view does. As a function
   * it gets the way to open a story, case or observation from the stage.
   */
  stage?: ReactNode | ((openRef: (target: ArtifactRef) => void) => ReactNode);
  /** How a finished analysis shows how the team worked: only its corrections, or everything. */
  conversation?: 'collapsed' | 'full';
  /** Off where the page already offers the download, as the saved analysis does. */
  actions?: boolean;
}

const CONNECTION_TEXT: Record<Connection, string> = {
  conectando: 'Conectando…',
  en_vivo: 'En vivo',
  reconectando: 'Reconectando…',
  cerrado: '',
};

function Card({
  title,
  extra,
  children,
  label,
  anchor,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  label: string;
  /** Lets a reference open this card. */
  anchor?: string;
}) {
  return (
    <section
      className={`${styles.card} ${anchor ? styles.target : ''}`}
      aria-labelledby={label}
      id={anchor}
      tabIndex={anchor ? -1 : undefined}
    >
      <div className={styles.cardHead}>
        <h2 id={label} className={styles.cardTitle}>
          {title}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function AgentFlow({
  state,
  connection,
  onOpenAgent,
}: Pick<ClassicViewProps, 'state' | 'connection' | 'onOpenAgent'>) {
  const live = connection && connection !== 'cerrado';
  return (
    <Card
      title="Flujo de agentes"
      label="flow-title"
      extra={
        <>
          <p className={styles.headline}>{runHeadline(state)}</p>
          {live && (
            <span className={styles.live} role="status">
              <span
                className={`${styles.dot} ${connection === 'en_vivo' ? '' : styles.dotWaiting}`}
              />
              {CONNECTION_TEXT[connection]}
            </span>
          )}
        </>
      }
    >
      <ul className={styles.agents}>
        {AGENT_IDS.map((id) => {
          const info = AGENTS[id];
          const summary = agentSummary(state, id);
          const estado = state.agentes[id].estado;
          return (
            <li key={id} className={styles.agent}>
              <div className={styles.agentHead}>
                <Ficha
                  color={info.color}
                  shadow={info.sombra}
                  size={40}
                  rol={info.icono}
                  trabajando={estado === 'trabajando'}
                />
                <div>
                  <h3 className={styles.agentName}>{info.nombre}</h3>
                  <p className={styles.agentLabel}>{info.etiqueta}</p>
                </div>
              </div>
              <div>
                <span
                  className={`${styles.status} ${estado === 'entrego' ? styles.statusDone : ''} ${estado === 'error' ? styles.statusError : ''}`}
                >
                  {estado === 'entrego' && <Icon name="palomita" size={16} />}
                  {estado === 'error' && <Icon name="alerta" size={16} />}
                  {summary.estado}
                </span>
                {summary.detalle && <p className={styles.detail}>{summary.detalle}</p>}
              </div>
              {onOpenAgent && (
                <button
                  type="button"
                  className={styles.agentLink}
                  onClick={() => onOpenAgent(id)}
                  aria-label={`Ver agente ${info.nombre}`}
                >
                  Ver agente
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Rubric({ state, judgeLabel }: { state: RunState; judgeLabel?: string }) {
  const media = promedio(state.puntajes);
  return (
    <Card
      anchor={anchorOf({ kind: 'rubrica', id: 'rubrica' })}
      title="Rúbrica"
      label="rubric-title"
      extra={
        media !== null && (
          <span className={`${styles.big} ${motion.fade}`}>
            {media.toFixed(1)}
            <span className={styles.headline}>/5</span>
          </span>
        )
      }
    >
      {state.puntajes.length ? (
        <dl className={styles.bars}>
          {state.puntajes.map((p) => (
            <div
              key={p.criterio}
              className={`${styles.bar} ${motion.enter}`}
              title={p.justificacion}
            >
              <dt>{CRITERIO_LABEL[p.criterio]}</dt>
              <dd>{p.valor.toFixed(1)}</dd>
              <span className={styles.track} aria-hidden="true">
                <svg width="100%" height="8" preserveAspectRatio="none" viewBox="0 0 100 8">
                  <rect
                    width={(p.valor / 5) * 100}
                    height="8"
                    rx="4"
                    fill="var(--color-agent-evaluador)"
                  />
                </svg>
              </span>
            </div>
          ))}
        </dl>
      ) : (
        <p className={styles.empty}>El Evaluador califica al final.</p>
      )}
      {state.modelos && media !== null && (
        <p className={styles.footnote}>
          Calificado por el Evaluador ({judgeLabel ?? state.modelos.juez}).
          {state.juezMismoProveedor && ' El juez es del mismo proveedor que la generación.'}
        </p>
      )}
    </Card>
  );
}

const FALLBACK_TITLE: Record<string, string> = {
  sin_saldo: 'no tiene saldo',
  clave_invalida: 'no es válida',
  limite_proveedor: 'alcanzó su límite',
};

function Fallback({ state, onUseFree }: { state: RunState; onUseFree: () => void }) {
  const error = state.error;
  if (!error) return null;
  const proveedor =
    state.proveedor && state.proveedor !== 'groq' ? state.proveedor : 'tu proveedor';
  const nombre =
    { openai: 'OpenAI', anthropic: 'Anthropic', openai_compatible: 'tu servicio compatible' }[
      proveedor
    ] ?? proveedor;
  const donde = error.agente === 'sistema' ? '' : ` en ${AGENTS[error.agente].nombre}`;
  return (
    <section
      className={`${styles.fallback} ${motion.enter}`}
      role="alert"
      aria-labelledby="fallback-title"
    >
      <span className={styles.fallbackIcon}>
        <Icon name="alerta" />
      </span>
      <div>
        <h2 id="fallback-title" className={styles.fallbackTitle}>
          Tu clave de {nombre} {FALLBACK_TITLE[error.codigo] ?? 'falló'}
        </h2>
        <p className={styles.itemText}>
          El análisis se detuvo{donde}. No se envió nada a otro proveedor.
        </p>
        <div className={styles.fallbackActions}>
          <Button variant="primary" onClick={onUseFree}>
            Usar el gratuito
          </Button>
          <Link href="/ajustes/modelos" className={buttonClass()}>
            Ir a Modelos y claves
          </Link>
        </div>
        <p className={styles.itemText}>
          Si eliges el gratuito, tu requerimiento se enviará a Groq y el análisis empezará de nuevo.
        </p>
      </div>
    </section>
  );
}

function ApprovalProgress() {
  return (
    <ol className={styles.progress} aria-label="Progreso">
      <li className={`${styles.step} ${styles.stepDone}`}>Analista · entregó</li>
      <li className={`${styles.step} ${styles.stepYou}`} aria-current="step">
        Tú · revisando
      </li>
      <li className={styles.step}>QA</li>
      <li className={styles.step}>Revisor</li>
      <li className={styles.step}>Evaluador</li>
    </ol>
  );
}

export function ClassicView({
  state,
  requerimiento,
  connection,
  onOpenAgent,
  approval,
  onUseFree,
  judgeLabel,
  saved,
  onNewAnalysis,
  stage,
  actions = true,
  conversation = 'collapsed',
}: ClassicViewProps) {
  const waiting = state.fase === 'esperando_aprobacion' && approval;
  const finished = state.fase === 'completada' || state.fase === 'error';
  const [tab, setTab] = useState('historias');
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const openRef = useCallback(
    (target: ArtifactRef) => {
      const lists: Record<ArtifactRef['kind'], readonly { id?: string }[]> = {
        historia: state.historias,
        caso: state.casos,
        observacion: state.observaciones.map((_, i) => ({ id: observationLabel(i + 1) })),
        rubrica: [],
      };
      const tabId = REF_TAB[target.kind];
      if (tabId) setTab(tabId);
      setReveal({ ref: target, index: lists[target.kind].findIndex((i) => i.id === target.id) });
    },
    [state.historias, state.casos, state.observaciones],
  );

  useEffect(() => {
    if (!reveal) return;
    const anchor = anchorOf(reveal.ref);
    const candidates = [anchor, `${anchor}-movil`]
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    const element = candidates.find((e) => e.getClientRects().length > 0) ?? candidates[0];
    if (!element) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [reveal]);

  const revealFor = (kind: ArtifactRef['kind']) => (reveal?.ref.kind === kind ? reveal : null);
  const messages = useMemo(() => teamMessages(state.eventos), [state.eventos]);
  const shownStage = typeof stage === 'function' ? stage(openRef) : stage;
  const team =
    finished && !shownStage && messages.length > 0 ? (
      <div className={motion.enter}>
        <TeamWork messages={messages} start={state.inicio} onOpen={openRef} mode={conversation} />
      </div>
    ) : null;
  const flow = (
    <div className={motion.fade}>
      <AgentFlow state={state} connection={connection} onOpenAgent={onOpenAgent} />
    </div>
  );
  return (
    <div className={styles.view}>
      {shownStage ?? (team && conversation === 'full' ? team : flow)}
      {state.error?.respaldoSugerido && onUseFree && (
        <Fallback state={state} onUseFree={onUseFree} />
      )}
      {state.error && !state.error.respaldoSugerido && (
        <section
          className={`${styles.fallback} ${motion.enter}`}
          role="alert"
          aria-label="Error del análisis"
        >
          <span className={styles.fallbackIcon}>
            <Icon name="alerta" />
          </span>
          <p className={styles.itemText}>{state.error.mensaje}</p>
        </section>
      )}
      {conversation === 'collapsed' && team}
      <div className={styles.main}>
        {waiting ? (
          <section className={styles.card} aria-label="Pausa humana">
            <ApprovalProgress />
            <ApprovalPanel
              key={state.ultimoSeq}
              historias={state.historias}
              otrasVersiones={state.otrasVersiones}
              busy={approval.busy}
              onAnswer={approval.onAnswer}
            />
          </section>
        ) : (
          <Card title="Artefactos" label="artifacts-title">
            {finished && actions && (
              <div className={motion.enter}>
                <ResultActions
                  state={state}
                  requerimiento={requerimiento}
                  unsaved={saved === false}
                  onNewAnalysis={onNewAnalysis}
                />
              </div>
            )}
            <Tabs
              label="Artefactos"
              selected={tab}
              onSelect={setTab}
              items={[
                {
                  id: 'historias',
                  label: 'Historias',
                  content: <Historias state={state} reveal={revealFor('historia')} />,
                },
                {
                  id: 'casos',
                  label: 'Casos de prueba',
                  content: <Casos state={state} reveal={revealFor('caso')} />,
                },
                {
                  id: 'gherkin',
                  label: 'Gherkin',
                  content: <Gherkin state={state} onOpen={openRef} />,
                },
                {
                  id: 'observaciones',
                  label: 'Observaciones',
                  content: <Observaciones state={state} reveal={revealFor('observacion')} />,
                },
              ]}
            />
          </Card>
        )}
        <div className={styles.aside}>
          <Rubric state={state} judgeLabel={judgeLabel} />
          {!shownStage && <EventLog state={state} />}
        </div>
      </div>
    </div>
  );
}
