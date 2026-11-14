'use client';

import { useEffect, useRef } from 'react';

import { AGENTS } from '@/entities/corrida';
import { Button, Ficha, Icon } from '@/shared/ui';

import type { WaitStage } from '../model/waiting';
import styles from './WaitOverlay.module.css';

export interface WaitOverlayProps {
  stage: WaitStage;
  onRetry: () => void;
  onCancel: () => void;
  onStartAnyway: () => void;
}

function Message({ stage }: { stage: WaitStage }) {
  switch (stage) {
    case 'preparando':
      return (
        <>
          <p className={styles.title}>
            Estamos preparando todo
            <span className={styles.dots} aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
          <p className={styles.text}>
            El Evaluador está acomodando los papeles. La primera vez después de un rato tarda unos
            segundos.
          </p>
        </>
      );
    case 'listo':
      return (
        <>
          <p className={`${styles.title} ${styles.ready}`}>
            <Icon name="palomita" size={24} />
            ¡Todo listo!
          </p>
          <p className={styles.text}>Empezando tu análisis.</p>
        </>
      );
    case 'sin_conexion':
      return (
        <>
          <p className={styles.title}>No logramos conectar</p>
          <p className={styles.text}>
            Suele ser algo temporal. Tu requerimiento sigue aquí; puedes reintentar en un momento.
          </p>
        </>
      );
    case 'creado_sin_abrir':
      return (
        <>
          <p className={styles.title}>No logramos conectar</p>
          <p className={styles.text}>
            Tu análisis sí se creó, pero no pudimos abrirlo. Se liberará solo en una hora.
          </p>
        </>
      );
    case 'oculta':
      return null;
  }
}

/** Covers the page while a new analysis takes more than a moment to open. */
export function WaitOverlay({ stage, onRetry, onCancel, onStartAnyway }: WaitOverlayProps) {
  const next = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const evaluador = AGENTS.evaluador;
  const shown = stage !== 'oculta';
  const failed = stage === 'sin_conexion' || stage === 'creado_sin_abrir';

  useEffect(() => {
    // A second analysis is never one keypress away: that case starts on Cancelar.
    const target =
      stage === 'sin_conexion'
        ? next.current
        : stage === 'creado_sin_abrir'
          ? cancel.current
          : null;
    if (!target) return;
    // A dialog that is still closing keeps the rest of the page inert, so try for a moment.
    let frame = 0;
    let tries = 0;
    const take = () => {
      target.focus();
      if (document.activeElement !== target && tries++ < 60) frame = requestAnimationFrame(take);
    };
    take();
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  return (
    <div className={shown ? styles.overlay : undefined}>
      <div role="status" aria-live="polite" className={shown ? styles.card : 'sr-only'}>
        {shown && (
          <div className={styles.stage} aria-hidden="true">
            <span className={styles.floor} />
            <span className={stage === 'preparando' ? styles.walker : styles.still}>
              <span className={stage === 'preparando' ? styles.bob : undefined}>
                <Ficha
                  color={evaluador.color}
                  shadow={evaluador.sombra}
                  size={96}
                  rol={evaluador.icono}
                  patas
                  lentes
                  papeles={stage !== 'listo'}
                  andar={stage === 'preparando'}
                />
              </span>
            </span>
          </div>
        )}
        <Message stage={stage} />
        {failed && (
          <div className={styles.actions}>
            <Button ref={cancel} onClick={onCancel}>
              Cancelar
            </Button>
            {stage === 'sin_conexion' ? (
              <Button ref={next} variant="primary" onClick={onRetry}>
                Reintentar
              </Button>
            ) : (
              <Button variant="primary" onClick={onStartAnyway}>
                Iniciar otro
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
