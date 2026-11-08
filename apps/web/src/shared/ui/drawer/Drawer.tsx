'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { Icon } from '../icon/Icon';

import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** A modal side panel on the native dialog: focus trap and Escape come with it. */
export function Drawer({ open, title, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.drawer} aria-label={title} onClose={onClose}>
      {open && (
        <>
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
          <div className={styles.body}>{children}</div>
        </>
      )}
    </dialog>
  );
}
