import { Icon, type IconName } from '../icon/Icon';

import styles from './Ficha.module.css';

const SMILE_MIN_SIZE = 26;
const TEXT_LINES_MIN_SIZE = 48;

export interface FichaProps {
  color: string;
  shadow: string;
  size: number;
  title?: string;
  /** Role badge: the white circle with the agent's icon. */
  rol?: IconName;
  patas?: boolean;
  /** Sways gently while the agent works; still with reduced motion. */
  trabajando?: boolean;
}

export function Ficha({
  color,
  shadow,
  size,
  title,
  rol,
  patas = false,
  trabajando = false,
}: FichaProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  const height = patas ? 72 : 64;

  return (
    <svg
      width={size}
      height={(size * height) / 64}
      viewBox={`0 0 64 ${height}`}
      className={styles.ficha}
      {...a11y}
      data-testid="ficha"
    >
      <g
        className={trabajando ? styles.working : undefined}
        data-testid={trabajando ? 'ficha-working' : undefined}
      >
        {patas && (
          <g fill={shadow} data-testid="ficha-legs">
            <rect x="19" y="56" width="7" height="14" rx="3.5" />
            <rect x="38" y="56" width="7" height="14" rx="3.5" />
          </g>
        )}
        <path d="M14 6h30l14 14v30a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8Z" fill={color} />
        <path d="M44 6v10a4 4 0 0 0 4 4h10Z" fill={shadow} />
        <g className={styles.eyes}>
          <rect x="21" y="23" width="6" height="11" rx="3" fill="var(--color-ficha-ink)" />
          <rect x="37" y="23" width="6" height="11" rx="3" fill="var(--color-ficha-ink)" />
          <circle cx="25" cy="26" r="1.2" fill="#fff" />
          <circle cx="41" cy="26" r="1.2" fill="#fff" />
        </g>
        {size >= SMILE_MIN_SIZE && (
          <path
            d="M27 39.5q5 4 10 0"
            fill="none"
            stroke="var(--color-ficha-ink)"
            strokeWidth="2.2"
            strokeLinecap="round"
            data-testid="ficha-smile"
          />
        )}
        {size >= TEXT_LINES_MIN_SIZE && (
          <g fill="#fff" opacity="0.6" data-testid="ficha-lines">
            <rect x="17" y="46" width="30" height="2.6" rx="1.3" />
            <rect x="17" y="51" width="19" height="2.6" rx="1.3" />
          </g>
        )}
        {rol && (
          <g data-testid="ficha-badge">
            <circle cx="52" cy="52" r="11" fill="#fff" />
            <g transform="translate(45 45) scale(0.58)" color={color}>
              <Icon name={rol} size={24} />
            </g>
          </g>
        )}
      </g>
    </svg>
  );
}
