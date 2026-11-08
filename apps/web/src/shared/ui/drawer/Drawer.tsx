'use client';

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

import { Icon } from '../icon/Icon';

import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function closeAfterExit(dialog: HTMLDialogElement) {
  dialog.setAttribute('data-closing', '');
  const running = typeof dialog.getAnimations === 'function' ? dialog.getAnimations() : [];
  const finish = () => {
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
    dialog.close();
  };
  if (running.length === 0) finish();
  else void Promise.all(running.map((animation) => animation.finished)).then(finish, finish);
}

/** A modal side panel on the native dialog: focus trap and Escape come with it. */
export function Drawer({ open, title, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // The last content stays on screen while the panel slides out; nothing renders before opening.
  const [shown, setShown] = useState<ReactNode>(null);
  if (open && shown !== children) setShown(children);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      dialog.removeAttribute('data-closing');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      closeAfterExit(dialog);
    }
  }, [open]);

  // Escape would close the dialog at once; the parent closes it so the exit can play.
  const cancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className={styles.drawer}
      aria-label={title}
      onCancel={cancel}
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
