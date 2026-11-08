import type { ReactNode } from 'react';

import { Icon } from '../icon/Icon';

import styles from './Notice.module.css';

export interface NoticeProps {
  tone?: 'info' | 'error' | 'ok';
  children: ReactNode;
  /** Errors are announced; informative notices are not. */
  live?: boolean;
}

export function Notice({ tone = 'info', children, live = tone === 'error' }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={live ? 'alert' : undefined}>
      <Icon name={tone === 'error' ? 'alerta' : tone === 'ok' ? 'palomita' : 'info'} size={18} />
      <div>{children}</div>
    </div>
  );
}
