'use client';

import { useState, type ReactNode } from 'react';

import { Button } from '../button/Button';

import styles from './Paged.module.css';

export interface PagedProps<T> {
  items: readonly T[];
  /** What is paged, for the navigation's name: "Páginas de casos de prueba". */
  label: string;
  pageSize?: number;
  children: (pageItems: T[]) => ReactNode;
}

/**
 * Pages a list inside its card. Every page sits in the same grid cell and only the current one is
 * visible, so the card keeps the height of its tallest page and nothing moves when paging.
 */
export function Paged<T>({ items, label, pageSize = 10, children }: PagedProps<T>) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  if (pages === 1) return <>{children([...items])}</>;

  const go = (next: number) => {
    if (next >= 1 && next <= pages) setPage(next);
  };
  return (
    <div className={styles.paged}>
      <div className={styles.stack}>
        {Array.from({ length: pages }, (_, index) => {
          const shown = index + 1 === current;
          return (
            <div
              key={index}
              className={shown ? `${styles.page} ${styles.current}` : styles.page}
              inert={!shown}
              data-page={index + 1}
            >
              {children(items.slice(index * pageSize, (index + 1) * pageSize))}
            </div>
          );
        })}
      </div>
      <nav className={styles.nav} aria-label={label}>
        <Button small aria-disabled={current === 1} onClick={() => go(current - 1)}>
          Anterior
        </Button>
        <p className={styles.status} aria-live="polite">
          Página {current} de {pages}
        </p>
        <Button small aria-disabled={current === pages} onClick={() => go(current + 1)}>
          Siguiente
        </Button>
      </nav>
    </div>
  );
}
