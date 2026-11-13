'use client';

import { useId, useRef, type ReactNode } from 'react';

import styles from './Dialog.module.css';
import { useModal } from './useModal';

export interface DialogProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  /** The buttons; the first one gets the focus when the dialog opens. */
  actions: ReactNode;
}

/** A centered confirmation that asks before something is lost. */
export function Dialog({ open, title, description, onClose, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const modal = useModal(ref, open, onClose);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onClose={onClose}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <p id={descriptionId} className={styles.description}>
        {description}
      </p>
      <div className={styles.actions}>{actions}</div>
    </dialog>
  );
}
