'use client';

import { useState } from 'react';

import {
  AGENTS,
  anchorOf,
  featuresOf,
  gherkinSteps,
  OBSERVACION_LABEL,
  observationLabel,
  ref,
  scenarioOrigin,
  scenarioText,
  toFeature,
  type ArtifactRef,
  type GherkinKeyword,
  type RunState,
} from '@/entities/corrida';
import { download } from '@/features/exportar';
import type { CasoPrueba } from '@/shared/api';
import { Badge, Button, Ficha, Icon, motion, Paged } from '@/shared/ui';

import styles from './ClassicView.module.css';

/** A reference being opened, with its position in the list that shows it. */
export interface Reveal {
  ref: ArtifactRef;
  index: number;
}

interface TabProps {
  state: RunState;
  reveal: Reveal | null;
}

export function Historias({ state, reveal }: TabProps) {
  if (!state.historias.length) return <p className={styles.empty}>Aún no hay historias.</p>;
  return (
    <Paged items={state.historias} label="Páginas de historias" reveal={reveal}>
      {(page) => (
        <ul className={styles.stack}>
          {page.map((h) => (
            <li
              key={h.id}
              id={anchorOf({ kind: 'historia', id: h.id })}
              tabIndex={-1}
              className={`${styles.item} ${styles.target} ${motion.enter}`}
            >
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
      )}
    </Paged>
  );
}

const origin = (o: 'qa' | 'revisor') => (
  <Badge tone={o === 'revisor' ? 'revisor' : 'neutral'}>{o === 'revisor' ? 'Revisor' : 'QA'}</Badge>
);

export function Casos({ state, reveal }: TabProps) {
  if (!state.casos.length) return <p className={styles.empty}>Aún no hay casos de prueba.</p>;
  return (
    <Paged items={state.casos} label="Páginas de casos de prueba" reveal={reveal}>
      {(page) => (
        <>
          <table className={styles.table}>
            <caption className="sr-only">
              Casos de prueba con su historia, resultado esperado y origen
            </caption>
            <thead>
              <tr>
                <th scope="col" className={styles.colId}>
                  ID
                </th>
                <th scope="col" className={styles.colId}>
                  Historia
                </th>
                <th scope="col">Caso</th>
                <th scope="col">Resultado esperado</th>
                <th scope="col" className={styles.colOrigin}>
                  Origen
                </th>
              </tr>
            </thead>
            <tbody>
              {page.map((c) => (
                <tr
                  key={c.id}
                  id={anchorOf({ kind: 'caso', id: c.id })}
                  tabIndex={-1}
                  className={`${styles.target} ${motion.enter}`}
                >
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
            {page.map((c) => (
              <li
                key={c.id}
                id={`${anchorOf({ kind: 'caso', id: c.id })}-movil`}
                tabIndex={-1}
                className={`${styles.item} ${styles.target} ${motion.enter}`}
              >
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
      )}
    </Paged>
  );
}

const KEYWORD_CLASS: Record<GherkinKeyword, string | undefined> = {
  Dado: styles.kwDado,
  Cuando: styles.kwCuando,
  Entonces: styles.kwEntonces,
  Y: styles.kwY,
  Pero: styles.kwPero,
};

const featureFile = (state: RunState) =>
  `criteria-${(state.runId ?? 'analisis').slice(0, 8)}.feature`;

function Scenario({
  caso,
  state,
  onCopy,
  onOpen,
}: {
  caso: CasoPrueba;
  state: RunState;
  onCopy: (text: string, what: string) => void;
  onOpen: (target: ArtifactRef) => void;
}) {
  const note = scenarioOrigin(caso, state.observaciones);
  const revisor = AGENTS.revisor;
  return (
    <article className={`${styles.scenario} ${motion.enter}`} aria-label={`Escenario ${caso.id}`}>
      <div className={styles.scenarioHead}>
        <span className={styles.scenarioLabel}>Escenario</span>
        <span className={styles.scenarioTitle}>{caso.gherkin.escenario}</span>
        <span className={styles.caseTag}>{caso.id}</span>
        <button
          type="button"
          className={styles.copy}
          aria-label={`Copiar el escenario ${caso.id}`}
          onClick={() => onCopy(scenarioText(caso), `el escenario ${caso.id}`)}
        >
          <Icon name="copiar" size={18} />
        </button>
      </div>
      <ol className={styles.steps}>
        {gherkinSteps(caso.gherkin).map((step, i) => (
          <li key={i} className={styles.stepRow}>
            <span className={`${styles.keyword} ${KEYWORD_CLASS[step.keyword] ?? ''}`}>
              {step.keyword}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
      {note && (
        <div className={styles.origin}>
          <Ficha color={revisor.color} shadow={revisor.sombra} size={26} rol={revisor.icono} />
          <div className={styles.originText}>
            <p className={styles.originTitle}>{note.titulo}</p>
            {note.observacion && (
              <>
                <p className={styles.itemText}>«{note.observacion.descripcion}»</p>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() =>
                    onOpen(ref('observacion', observationLabel(note.observacion!.numero)))
                  }
                >
                  Ver la observación {observationLabel(note.observacion.numero)}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function Gherkin({
  state,
  onOpen,
}: {
  state: RunState;
  onOpen: (target: ArtifactRef) => void;
}) {
  const [copied, setCopied] = useState('');
  if (!state.casos.length) return <p className={styles.empty}>Aún no hay escenarios.</p>;
  const qa = AGENTS.qa;

  const copy = (text: string, what: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(`Copiaste ${what}.`))
      .catch(() => setCopied('No se pudo copiar; selecciona el texto y cópialo a mano.'));
  };

  return (
    <div className={styles.stack}>
      <div className={styles.gherkinTools}>
        <p className={styles.copied} role="status">
          {copied}
        </p>
        <Button small onClick={() => copy(toFeature(state), 'todos los escenarios')}>
          Copiar todo
        </Button>
        <Button small onClick={() => download(featureFile(state), toFeature(state), 'text/plain')}>
          Descargar .feature
        </Button>
      </div>
      <Paged
        items={featuresOf(state.historias, state.casos)}
        label="Páginas de escenarios Gherkin"
        pageSize={4}
      >
        {(page) => (
          <div className={styles.stack}>
            {page.map((feature) => (
              <section
                key={feature.historiaId}
                className={styles.feature}
                aria-labelledby={`feature-${feature.historiaId}`}
              >
                <div className={styles.featureHead}>
                  <span className={styles.featureTag}>Característica</span>
                  <h3 id={`feature-${feature.historiaId}`} className={styles.featureTitle}>
                    <span className={styles.featureId}>{feature.historiaId}</span> {feature.titulo}
                  </h3>
                  <span className={styles.author}>
                    <Ficha color={qa.color} shadow={qa.sombra} size={22} rol={qa.icono} />
                    Escrito por QA
                  </span>
                </div>
                {feature.casos.map((caso) => (
                  <Scenario key={caso.id} caso={caso} state={state} onCopy={copy} onOpen={onOpen} />
                ))}
              </section>
            ))}
          </div>
        )}
      </Paged>
    </div>
  );
}

export function Observaciones({ state, reveal }: TabProps) {
  if (!state.observaciones.length) {
    return (
      <p className={styles.empty}>
        {state.revisorAprobo ? 'El Revisor no dejó observaciones.' : 'Aún no hay observaciones.'}
      </p>
    );
  }
  const numbered = state.observaciones.map((item, i) => ({
    ...item,
    label: observationLabel(i + 1),
  }));
  return (
    <Paged items={numbered} label="Páginas de observaciones" reveal={reveal}>
      {(page) => (
        <ul className={styles.stack}>
          {page.map(({ observacion: o, ronda, seCorrige, label }) => (
            <li
              key={label}
              id={anchorOf({ kind: 'observacion', id: label })}
              tabIndex={-1}
              className={`${styles.item} ${styles.target} ${motion.enter}`}
            >
              <div className={styles.itemHead}>
                <span className={styles.observationHead}>
                  <span className={styles.mono}>{label}</span>
                  <Badge tone="revisor">{OBSERVACION_LABEL[o.tipo]}</Badge>
                </span>
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
      )}
    </Paged>
  );
}
