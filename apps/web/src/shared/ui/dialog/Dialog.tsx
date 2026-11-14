'use client';

import { useId, useRef, type ReactNode } from 'react';

import styles from './Dialog.module.css';
import { useModal } from './useModal';

export interface DialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  onClose: () => void;
  /** The buttons, left to right; the first one sits apart on the left and gets the focus. */
  actions: ReactNode;
  /** A decorative mark beside the title, such as a clock for a limit. */
  icon?: ReactNode;
}

/** A centered confirmation that asks before something is lost or explains why it stopped. */
export function Dialog({ open, title, description, onClose, actions, icon }: DialogProps) {
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
      <div className={styles.head}>
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        <div>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        </div>
      </div>
      <div className={styles.actions}>{actions}</div>
    </dialog>
  );
}
