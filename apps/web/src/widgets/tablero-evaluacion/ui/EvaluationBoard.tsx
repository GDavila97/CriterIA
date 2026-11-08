'use client';

import { useMemo, useState } from 'react';

import type { EvaluationBatchBody } from '@/shared/api';
import { Ficha, SelectField } from '@/shared/ui';

import styles from './EvaluationBoard.module.css';

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const seconds = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 1000)} s`);
const dollars = (value: number | null) => (value === null ? '—' : `$${value.toFixed(3)}`);

function Methodology() {
  return (
    <section className={styles.card} aria-labelledby="method-title">
      <h2 id="method-title" className={styles.cardTitle}>
        Cómo se mide
      </h2>
      <ul className={styles.method}>
        <li>15 requerimientos: 5 fáciles, 5 medios y 5 con ambigüedades sembradas.</li>
        <li>Rúbrica de 1 a 5: claridad, verificabilidad, completitud y consistencia.</li>
        <li>
          El mismo grafo y el mismo juez para todos los modelos; el juez tiene versión propia.
        </li>
        <li>Un modelo local en una RTX 4060 con Ollama, junto a modelos por API.</li>
      </ul>
    </section>
  );
}

export function EvaluationBoard({ lotes }: { lotes: EvaluationBatchBody[] }) {
  const versions = useMemo(
    () => [...new Set(lotes.map((l) => l.prompt_version))].sort().reverse(),
    [lotes],
  );
  const [version, setVersion] = useState(versions[0] ?? '');
  const shown = lotes.filter((l) => l.prompt_version === version);
  const fastest = [...shown]
    .filter((l) => l.latency_p50_ms !== null)
    .sort((a, b) => (a.latency_p50_ms ?? 0) - (b.latency_p50_ms ?? 0))[0];
  const mostValid = [...shown]
    .filter((l) => l.valid_rate !== null)
    .sort((a, b) => (b.valid_rate ?? 0) - (a.valid_rate ?? 0))[0];

  return (
    <div className={styles.board}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Evaluación de modelos</h1>
          <p className={styles.lead}>
            Mismo conjunto de requerimientos, mismo grafo y mismo juez para todos los modelos.
          </p>
        </div>
        {versions.length > 0 && (
          <SelectField
            label="Versión de prompts"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            options={versions.map((v) => ({ value: v, label: v }))}
          />
        )}
      </div>

      {lotes.length === 0 ? (
        <section className={`${styles.card} ${styles.empty}`} aria-label="Sin resultados">
          <Ficha
            color="var(--color-agent-evaluador)"
            shadow="var(--color-agent-evaluador-shadow)"
            size={72}
            rol="estrella"
          />
          <p>Los resultados se publicarán tras la primera evaluación.</p>
        </section>
      ) : (
        <>
          <div className={styles.kpis}>
            <section className={styles.card} aria-label="Más rápido">
              <p className={styles.kpiLabel}>Más rápido (latencia p50)</p>
              <p className={styles.kpiValue}>{seconds(fastest?.latency_p50_ms ?? null)}</p>
              <p className={styles.kpiLabel}>
                {fastest ? `${fastest.provider} · ${fastest.model}` : '—'}
              </p>
            </section>
            <section className={styles.card} aria-label="Más salidas válidas">
              <p className={styles.kpiLabel}>Más salidas válidas</p>
              <p className={styles.kpiValue}>{percent(mostValid?.valid_rate ?? null)}</p>
              <p className={styles.kpiLabel}>
                {mostValid ? `${mostValid.provider} · ${mostValid.model}` : '—'}
              </p>
            </section>
            <section className={styles.card} aria-label="Casos">
              <p className={styles.kpiLabel}>Casos por lote</p>
              <p className={styles.kpiValue}>{shown[0]?.cases ?? 0}</p>
              <p className={styles.kpiLabel}>{shown.length} modelos</p>
            </section>
          </div>
          <section className={styles.card} aria-labelledby="compare-title">
            <h2 id="compare-title" className={styles.cardTitle}>
              Comparación por modelo
            </h2>
            <div
              className={styles.scroll}
              tabIndex={0}
              role="region"
              aria-label="Tabla de comparación por modelo"
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Modelo</th>
                    <th scope="col">Salidas válidas</th>
                    <th scope="col">Latencia p50</th>
                    <th scope="col">Latencia p95</th>
                    <th scope="col">Costo por corrida</th>
                    <th scope="col">Juez</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.provider} · {l.model}
                        {l.judge_model.startsWith(`${l.provider}:`) && ' *'}
                      </td>
                      <td>{percent(l.valid_rate)}</td>
                      <td>{seconds(l.latency_p50_ms)}</td>
                      <td>{seconds(l.latency_p95_ms)}</td>
                      <td>{dollars(l.cost_usd_avg)}</td>
                      <td>{l.judge_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              * El juez es del mismo proveedor que este modelo; su puntaje puede tener sesgo de
              autopreferencia.
            </p>
          </section>
        </>
      )}
      <Methodology />
    </div>
  );
}
