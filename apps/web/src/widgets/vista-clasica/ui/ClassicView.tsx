'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  AGENT_IDS,
  AGENTS,
  agentSummary,
  CRITERIO_LABEL,
  formatClock,
  OBSERVACION_LABEL,
  promedio,
  runHeadline,
  type AgentId,
  type RunState,
} from '@/entities/corrida';
import { ApprovalPanel } from '@/features/aprobar-historias';
import type { Connection } from '@/features/ejecutar-corrida';
import { ExportButtons } from '@/features/exportar';
import type { RespuestaHumana } from '@/shared/api';
import { Badge, Button, buttonClass, Ficha, Icon, motion, Tabs } from '@/shared/ui';

import styles from './ClassicView.module.css';

export interface ClassicViewProps {
  state: RunState;
  requerimiento: string;
  connection?: Connection;
  onOpenAgent?: (id: AgentId) => void;
  /** Present while a live run can be answered. */
  approval?: { busy: boolean; onAnswer: (respuesta: RespuestaHumana) => void };
  /** Offers the free mode after a key failure; it only runs after the click. */
  onUseFree?: () => void;
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
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <section className={styles.card} aria-labelledby={label}>
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

function Historias({ state }: { state: RunState }) {
  if (!state.historias.length) return <p className={styles.empty}>Aún no hay historias.</p>;
  return (
    <ul className={styles.stack}>
      {state.historias.map((h) => (
        <li key={h.id} className={`${styles.item} ${motion.enter}`}>
          <div className={styles.itemHead}>
            <span className={styles.mono}>{h.id}</span>
            <Badge>Prioridad {h.prioridad}</Badge>
          </div>
          <p className={styles.itemTitle}>
            Como {h.como}, quiero {h.quiero} para {h.para}.
          </p>
          {h.supuestos?.map((s) => (
            <p key={s} className={styles.itemText}>
              Supuesto: {s}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

const origin = (o: 'qa' | 'revisor') => (
  <Badge tone={o === 'revisor' ? 'revisor' : 'neutral'}>{o === 'revisor' ? 'Revisor' : 'QA'}</Badge>
);

function Casos({ state }: { state: RunState }) {
  if (!state.casos.length) return <p className={styles.empty}>Aún no hay casos de prueba.</p>;
  return (
    <>
      <table className={styles.table}>
        <caption className="sr-only">
          Casos de prueba con su historia, resultado esperado y origen
        </caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Historia</th>
            <th scope="col">Caso</th>
            <th scope="col">Resultado esperado</th>
            <th scope="col">Origen</th>
          </tr>
        </thead>
        <tbody>
          {state.casos.map((c) => (
            <tr key={c.id} className={motion.enter}>
              <td className={styles.mono}>{c.id}</td>
              <td className={styles.mono}>{c.historia_id}</td>
              <td>{c.titulo}</td>
              <td>{c.resultado_esperado}</td>
              <td>{origin(c.origen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={`${styles.stack} ${styles.casesMobile}`}>
        {state.casos.map((c) => (
          <li key={c.id} className={`${styles.item} ${motion.enter}`}>
            <div className={styles.itemHead}>
              <span className={styles.mono}>
                {c.id} · {c.historia_id}
              </span>
              {origin(c.origen)}
            </div>
            <p className={styles.itemTitle}>{c.titulo}</p>
            <p className={styles.itemText}>{c.resultado_esperado}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function Gherkin({ state }: { state: RunState }) {
  if (!state.casos.length) return <p className={styles.empty}>Aún no hay escenarios.</p>;
  return (
    <div className={styles.stack}>
      {state.casos.map((c) => (
        <pre
          key={c.id}
          className={`${styles.gherkin} ${motion.enter}`}
          tabIndex={0}
          aria-label={`Escenario de ${c.id}`}
        >
          {[
            `Escenario: ${c.gherkin.escenario}`,
            ...c.gherkin.dado.map((s, i) => `  ${i ? 'Y' : 'Dado'} ${s}`),
            ...c.gherkin.cuando.map((s, i) => `  ${i ? 'Y' : 'Cuando'} ${s}`),
            ...c.gherkin.entonces.map((s, i) => `  ${i ? 'Y' : 'Entonces'} ${s}`),
          ].join('\n')}
        </pre>
      ))}
    </div>
  );
}

function Observaciones({ state }: { state: RunState }) {
  if (!state.observaciones.length) {
    return (
      <p className={styles.empty}>
        {state.revisorAprobo ? 'El Revisor no dejó observaciones.' : 'Aún no hay observaciones.'}
      </p>
    );
  }
  return (
    <ul className={styles.stack}>
      {state.observaciones.map(({ observacion: o, ronda, seCorrige }, i) => (
        <li key={`${ronda}-${i}`} className={`${styles.item} ${motion.enter}`}>
          <div className={styles.itemHead}>
            <Badge tone="revisor">{OBSERVACION_LABEL[o.tipo]}</Badge>
            <span className={styles.itemText}>
              Ronda {ronda + 1} · para {AGENTS[o.destino].nombre}
              {seCorrige ? '' : ' · pendiente'}
            </span>
          </div>
          <p className={styles.itemTitle}>{o.descripcion}</p>
          <p className={styles.itemText}>
            {o.referencias.join(', ')} · Sugerencia: {o.sugerencia}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Rubric({ state }: { state: RunState }) {
  const media = promedio(state.puntajes);
  return (
    <Card
      title="Rúbrica"
      label="rubric-title"
      extra={
        media !== null && (
          <span className={styles.big}>
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
          Calificado por el Evaluador ({state.modelos.juez}).
          {state.juezMismoProveedor && ' El juez es del mismo proveedor que la generación.'}
        </p>
      )}
    </Card>
  );
}

function EventLog({ state }: { state: RunState }) {
  const start = state.inicio ?? state.registro[0]?.ts;
  return (
    <Card title="Registro" label="log-title">
      {state.registro.length && start ? (
        <ol className={styles.log} aria-live="polite">
          {state.registro.map((entry) => (
            <li key={entry.seq} className={`${styles.logEntry} ${motion.enter}`}>
              <span className={styles.mono}>{formatClock(start, entry.ts)}</span>
              <span className={styles.logDot} aria-hidden="true">
                <svg width="8" height="8" viewBox="0 0 8 8">
                  <circle
                    cx="4"
                    cy="4"
                    r="4"
                    fill={
                      entry.agent === 'sistema' ? 'var(--color-muted)' : AGENTS[entry.agent].color
                    }
                  />
                </svg>
              </span>
              <span>{entry.texto}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>Los eventos aparecen aquí en vivo.</p>
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
    <section className={styles.fallback} role="alert" aria-labelledby="fallback-title">
      <span className={styles.fallbackIcon}>
        <Icon name="alerta" />
      </span>
      <div>
        <h2 id="fallback-title" className={styles.fallbackTitle}>
          Tu clave de {nombre} {FALLBACK_TITLE[error.codigo] ?? 'falló'}
        </h2>
        <p className={styles.itemText}>
          La corrida se detuvo{donde}. No se envió nada a otro proveedor.
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
          Si eliges el gratuito, tu requerimiento se enviará a Groq y la corrida empezará de nuevo.
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
}: ClassicViewProps) {
  const waiting = state.fase === 'esperando_aprobacion' && approval;
  const finished = state.fase === 'completada' || state.fase === 'error';
  return (
    <div className={styles.view}>
      <AgentFlow state={state} connection={connection} onOpenAgent={onOpenAgent} />
      {state.error?.respaldoSugerido && onUseFree && (
        <Fallback state={state} onUseFree={onUseFree} />
      )}
      {state.error && !state.error.respaldoSugerido && (
        <section className={styles.fallback} role="alert" aria-label="Error de la corrida">
          <span className={styles.fallbackIcon}>
            <Icon name="alerta" />
          </span>
          <p className={styles.itemText}>{state.error.mensaje}</p>
        </section>
      )}
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
          <Card
            title="Artefactos"
            label="artifacts-title"
            extra={
              finished && (
                <div className={styles.exports}>
                  <ExportButtons state={state} requerimiento={requerimiento} />
                </div>
              )
            }
          >
            <Tabs
              label="Artefactos"
              items={[
                { id: 'historias', label: 'Historias', content: <Historias state={state} /> },
                { id: 'casos', label: 'Casos de prueba', content: <Casos state={state} /> },
                { id: 'gherkin', label: 'Gherkin', content: <Gherkin state={state} /> },
                {
                  id: 'observaciones',
                  label: 'Observaciones',
                  content: <Observaciones state={state} />,
                },
              ]}
            />
          </Card>
        )}
        <div className={styles.aside}>
          <Rubric state={state} />
          <EventLog state={state} />
        </div>
      </div>
    </div>
  );
}
