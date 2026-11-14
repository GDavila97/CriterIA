'use client';

import { useRef, useState, type ReactNode } from 'react';

import { useModal } from '../dialog/useModal';
import { Icon } from '../icon/Icon';

import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider and in the page's theme, for work such as reviewing stories; dark and narrow otherwise. */
  amplio?: boolean;
}

/** A modal side panel: closes with Escape, the X or a click outside, and returns the focus. */
export function Drawer({ open, title, onClose, children, amplio = false }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // The last content stays on screen while the panel slides out; nothing renders before opening.
  const [shown, setShown] = useState<ReactNode>(null);
  if (open && shown !== children) setShown(children);
  const modal = useModal(ref, open, onClose);

  return (
    <dialog
      ref={ref}
      className={amplio ? `${styles.drawer} ${styles.amplio}` : styles.drawer}
      aria-label={title}
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onClose={onClose}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Cerrar"
          data-close
        >
          <Icon name="cerrar" />
        </button>
      </div>
      <div className={styles.body}>{open ? children : shown}</div>
    </dialog>
  );
}
