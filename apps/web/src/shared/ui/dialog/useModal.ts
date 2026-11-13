'use client';

import { useEffect, useRef, type MouseEvent, type RefObject, type SyntheticEvent } from 'react';

let scrollLocks = 0;
let previousOverflow = '';

/** Keeps the page behind a modal still; nested modals share one lock. */
export function lockScroll(): () => void {
  const root = document.documentElement;
  if (scrollLocks === 0) {
    previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0) root.style.overflow = previousOverflow;
  };
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

function outside(dialog: HTMLDialogElement, event: MouseEvent<HTMLDialogElement>): boolean {
  // Clicks on ::backdrop reach the dialog itself; inside the box they land on its content.
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/**
 * A native modal dialog that also closes on a backdrop click, keeps the page from scrolling and
 * gives the focus back to whatever opened it. showModal already traps the focus and maps Escape.
 */
export function useModal(
  ref: RefObject<HTMLDialogElement | null>,
  open: boolean,
  onClose: () => void,
) {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.removeAttribute('data-closing');
    if (!dialog.open) dialog.showModal();
    const unlock = lockScroll();
    return () => {
      unlock();
      if (dialog.open) closeAfterExit(dialog);
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) target.focus();
    };
  }, [ref, open]);

  return {
    // Escape would close the dialog at once; the parent closes it so the exit can play.
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (ref.current && outside(ref.current, event)) onClose();
    },
  };
}
