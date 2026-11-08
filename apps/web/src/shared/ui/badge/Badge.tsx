import type { ReactNode } from 'react';

import styles from './Badge.module.css';

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'revisor' | 'ok' | 'danger';
  children: ReactNode;
}) {
  return (
    <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>{children}</span>
  );
}
