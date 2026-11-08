'use client';

import { useState } from 'react';

import type { HistoriaUsuario, RespuestaHumana } from '@/shared/api';
import { Badge, Button, Icon, SelectField, TextArea, TextField } from '@/shared/ui';

import {
  answerFor,
  isComplete,
  MAX_NOTE,
  MAX_STORIES,
  nextId,
  type DraftStory,
} from '../model/draft';

import styles from './ApprovalPanel.module.css';

export const MAX_OTHER_VERSIONS = 2;

export interface ApprovalPanelProps {
  historias: HistoriaUsuario[];
  otrasVersiones: number;
  busy: boolean;
  onAnswer: (respuesta: RespuestaHumana) => void;
}

const PRIORIDAD: Record<HistoriaUsuario['prioridad'], string> = {
  alta: 'Prioridad alta',
  media: 'Prioridad media',
  baja: 'Prioridad baja',
};

function StoryEditor({
  historia,
  onChange,
}: {
  historia: HistoriaUsuario;
  onChange: (historia: HistoriaUsuario) => void;
}) {
  const field = (key: 'como' | 'quiero' | 'para', label: string) => (
    <TextField
      label={label}
      value={historia[key]}
      maxLength={300}
      onChange={(event) => onChange({ ...historia, [key]: event.target.value })}
      error={historia[key].trim() ? null : 'Este campo no puede quedar vacío.'}
    />
  );
  return (
    <div className={styles.edit}>
      {field('como', 'Como')}
      {field('quiero', 'Quiero')}
      {field('para', 'Para')}
      <SelectField
        label="Prioridad"
        value={historia.prioridad}
        onChange={(event) =>
          onChange({ ...historia, prioridad: event.target.value as HistoriaUsuario['prioridad'] })
        }
        options={[
          { value: 'alta', label: 'Alta' },
          { value: 'media', label: 'Media' },
          { value: 'baja', label: 'Baja' },
        ]}
      />
      <TextArea
        label="Supuestos (uno por línea)"
        rows={2}
        value={(historia.supuestos ?? []).join('\n')}
        onChange={(event) => onChange({ ...historia, supuestos: event.target.value.split('\n') })}
      />
    </div>
  );
}

export function ApprovalPanel({ historias, otrasVersiones, busy, onAnswer }: ApprovalPanelProps) {
  const [drafts, setDrafts] = useState<DraftStory[]>(() =>
    historias.map((historia) => ({ historia, incluida: true })),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [nota, setNota] = useState('');

  const included = drafts.filter((d) => d.incluida);
  const complete = included.every((d) => isComplete(d.historia));
  const versionsLeft = MAX_OTHER_VERSIONS - otrasVersiones;

  const update = (id: string, change: Partial<DraftStory>) =>
    setDrafts((current) => current.map((d) => (d.historia.id === id ? { ...d, ...change } : d)));

  const add = () => {
    const id = nextId(drafts);
    setDrafts((current) => [
      ...current,
      {
        incluida: true,
        historia: { id, como: '', quiero: '', para: '', prioridad: 'media', supuestos: [] },
      },
    ]);
    setEditing(id);
  };

  return (
    <section className={styles.panel} aria-labelledby="approval-title">
      <h2 id="approval-title" className={styles.title}>
        Revisa las historias antes de seguir
      </h2>
      <p className={styles.lead}>
        El Analista propuso {historias.length} {historias.length === 1 ? 'historia' : 'historias'}.
        Edita, quita o agrega las que necesites; QA trabajará solo con las que apruebes.
      </p>
      <ul className={styles.list}>
        {drafts.map(({ historia, incluida }) => (
          <li key={historia.id} className={`${styles.story} ${incluida ? '' : styles.excluded}`}>
            <input
              type="checkbox"
              checked={incluida}
              onChange={(event) => update(historia.id, { incluida: event.target.checked })}
              aria-label={`Incluir ${historia.id}`}
            />
            <div>
              <div className={styles.head}>
                <span className={styles.id}>{historia.id}</span>
                <Badge>{PRIORIDAD[historia.prioridad]}</Badge>
              </div>
              <p className={styles.sentence}>
                Como {historia.como || '…'}, quiero {historia.quiero || '…'} para{' '}
                {historia.para || '…'}.
              </p>
              {(historia.supuestos ?? []).filter(Boolean).map((supuesto) => (
                <p key={supuesto} className={styles.assumption}>
                  Supuesto: {supuesto}
                </p>
              ))}
            </div>
            <Button
              small
              onClick={() => setEditing(editing === historia.id ? null : historia.id)}
              aria-expanded={editing === historia.id}
              aria-label={`${editing === historia.id ? 'Terminar edición de' : 'Editar'} ${historia.id}`}
            >
              {editing === historia.id ? 'Listo' : 'Editar'}
            </Button>
            {editing === historia.id && (
              <StoryEditor
                historia={historia}
                onChange={(next) => update(historia.id, { historia: next })}
              />
            )}
          </li>
        ))}
      </ul>
      {drafts.length < MAX_STORIES && (
        <Button small className={styles.add} onClick={add}>
          <Icon name="mas" size={16} /> Agregar historia
        </Button>
      )}

      {asking && versionsLeft > 0 && (
        <div className={styles.again}>
          <TextArea
            label="¿Qué esperabas? (opcional)"
            rows={3}
            maxLength={MAX_NOTE}
            value={nota}
            onChange={(event) => setNota(event.target.value)}
            hint={`${nota.length} / ${MAX_NOTE}`}
          />
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              onAnswer(
                nota.trim()
                  ? { decision: 'otra_version', nota: nota.trim() }
                  : { decision: 'otra_version' },
              )
            }
          >
            Enviar al Analista
          </Button>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          disabled={busy || versionsLeft <= 0}
          aria-describedby={versionsLeft <= 0 ? 'versions-used' : undefined}
          onClick={() => setAsking((open) => !open)}
          aria-expanded={asking}
        >
          Pedir otra versión al Analista
        </Button>
        <Button
          variant="primary"
          disabled={busy || included.length === 0 || !complete}
          onClick={() => onAnswer(answerFor(historias, drafts))}
        >
          Aprobar {included.length} {included.length === 1 ? 'historia' : 'historias'} y continuar
        </Button>
      </div>
      {versionsLeft <= 0 && (
        <p id="versions-used" className={styles.note}>
          Ya pediste dos versiones nuevas en esta corrida. Edita las historias o apruébalas para
          seguir.
        </p>
      )}
      {included.length === 0 && (
        <p className={styles.note} role="status">
          Incluye al menos una historia para continuar.
        </p>
      )}
      <p className={styles.note}>
        La corrida espera hasta 1 hora. Después se descarta y no se guarda nada.
      </p>
    </section>
  );
}
