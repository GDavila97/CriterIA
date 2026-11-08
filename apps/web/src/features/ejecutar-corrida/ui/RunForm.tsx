'use client';

import { useMemo, useState, type FormEvent } from 'react';

import type { CatalogBody, SettingsBody, UsageBody } from '@/shared/api';
import { PROVIDER_NAMES, type ProviderId, type Tier } from '@/shared/config/providers';
import { useHydrated } from '@/shared/lib/react';
import { Button, CheckboxField, Notice, SelectField, TextArea, TextField } from '@/shared/ui';

import {
  autoJudge,
  COMPATIBLE_MODEL,
  defaultChoice,
  generationChoices,
  judgeCandidates,
  recipients,
} from '../model/choices';
import { EXAMPLES } from '../model/examples';
import { costText, keyKind, providerNotice } from '../model/notice';

import styles from './RunForm.module.css';

export const MIN_REQUIREMENT = 20;
export const MAX_REQUIREMENT = 2000;

export interface RunRequestDraft {
  requerimiento: string;
  proveedor: ProviderId;
  nivel?: Tier;
  modelo?: string;
  juez?: ProviderId;
  guardarHistorial: boolean;
}

export interface RunFormProps {
  catalog: CatalogBody;
  settings: SettingsBody | null;
  usage: UsageBody | null;
  busy: boolean;
  hasRun: boolean;
  initialRequirement?: string;
  onSubmit: (draft: RunRequestDraft) => void;
}

function remainingText(usage: UsageBody): string {
  const left = Math.max(0, usage.limite_hora - usage.corridas_hora);
  return `Te ${left === 1 ? 'queda' : 'quedan'} ${left} de ${usage.limite_hora} corridas esta hora`;
}

export function RunForm({
  catalog,
  settings,
  usage,
  busy,
  hasRun,
  initialRequirement = '',
  onSubmit,
}: RunFormProps) {
  const choices = useMemo(() => generationChoices(catalog), [catalog]);
  const candidates = useMemo(() => judgeCandidates(catalog), [catalog]);
  const [requerimiento, setRequerimiento] = useState(initialRequirement);
  const [choice, setChoice] = useState(() => defaultChoice(choices, catalog, settings));
  const [judge, setJudge] = useState<ProviderId | ''>(settings?.judge_provider ?? '');
  const [compatibleModel, setCompatibleModel] = useState('');
  const [save, setSave] = useState(settings?.save_history ?? false);
  const [touched, setTouched] = useState(false);
  const hydrated = useHydrated();

  const selected = choices.find((c) => c.value === choice) ?? choices[0];
  if (!selected) {
    return <Notice tone="error">No hay modelos disponibles. Revisa Modelos y claves.</Notice>;
  }
  const judgeProvider = judge || autoJudge(candidates, selected.provider);
  const sendTo = recipients(catalog, selected.provider, judgeProvider);
  const length = requerimiento.trim().length;
  const invalid = length < MIN_REQUIREMENT || length > MAX_REQUIREMENT;
  const needsModel = selected.value === COMPATIBLE_MODEL && !compatibleModel.trim();
  const notice = providerNotice(
    sendTo.map((r) => ({ provider: r.provider, kind: keyKind(r.provider, r.clave) })),
    judgeProvider === selected.provider,
  );
  const judgeClave = sendTo.find((r) => r.provider === judgeProvider)?.clave ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid || needsModel) return;
    onSubmit({
      requerimiento: requerimiento.trim(),
      proveedor: selected.provider,
      nivel: selected.nivel,
      modelo: selected.value === COMPATIBLE_MODEL ? compatibleModel.trim() : selected.modelo,
      juez: judge || undefined,
      guardarHistorial: save,
    });
  };

  return (
    <form className={styles.column} onSubmit={submit} aria-label="Nueva corrida" method="post">
      <section className={styles.card} aria-labelledby="req-title">
        <h2 id="req-title" className={styles.title}>
          Requerimiento
        </h2>
        <TextArea
          label="Describe lo que el sistema debe hacer, en lenguaje natural"
          rows={8}
          value={requerimiento}
          maxLength={MAX_REQUIREMENT}
          onChange={(event) => setRequerimiento(event.target.value)}
          error={
            touched && invalid
              ? `Escribe entre ${MIN_REQUIREMENT} y ${MAX_REQUIREMENT} caracteres.`
              : null
          }
        />
        <div className={styles.meta}>
          <span className={styles.examples}>
            Ejemplos:
            {EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                className={styles.example}
                onClick={() => setRequerimiento(example.texto)}
              >
                {example.label}
              </button>
            ))}
          </span>
          <span
            className={styles.counter}
            aria-label={`${length} de ${MAX_REQUIREMENT} caracteres`}
          >
            {length} / {MAX_REQUIREMENT}
          </span>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="models-title">
        <h2 id="models-title" className={styles.title}>
          Modelos
        </h2>
        <div className={styles.models}>
          <SelectField
            label="Generación"
            value={selected.value}
            onChange={(event) => setChoice(event.target.value)}
            options={choices.map((c) => ({ value: c.value, label: c.label }))}
          />
          <SelectField
            label="Juez"
            value={judge}
            onChange={(event) => setJudge(event.target.value as ProviderId | '')}
            options={[
              {
                value: '',
                label: `Automático (${PROVIDER_NAMES[autoJudge(candidates, selected.provider)]})`,
              },
              ...candidates.map((p) => ({ value: p, label: PROVIDER_NAMES[p] })),
            ]}
          />
        </div>
        {selected.value === COMPATIBLE_MODEL && (
          <TextField
            label="Modelo del servicio compatible"
            value={compatibleModel}
            onChange={(event) => setCompatibleModel(event.target.value)}
            error={touched && needsModel ? 'Escribe el nombre del modelo.' : null}
          />
        )}
        <Notice>
          {notice.map((part, i) =>
            part.strong ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>,
          )}
        </Notice>
        <p className={styles.cost}>
          {costText(catalog, selected, judgeProvider, keyKind(judgeProvider, judgeClave))}
        </p>
        <CheckboxField
          label="Guardar esta corrida en mi historial"
          checked={save}
          onChange={(event) => setSave(event.target.checked)}
        />
        <Button type="submit" variant="primary" block disabled={busy || !hydrated}>
          {hasRun ? 'Ejecutar de nuevo' : 'Ejecutar'}
        </Button>
        {usage && <p className={styles.footnote}>{remainingText(usage)}</p>}
      </section>
    </form>
  );
}
