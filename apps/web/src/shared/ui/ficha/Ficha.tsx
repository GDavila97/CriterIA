const SMILE_MIN_SIZE = 26;
const TEXT_LINES_MIN_SIZE = 48;

export interface FichaProps {
  color: string;
  shadow: string;
  size: number;
  title?: string;
}

export function Ficha({ color, shadow, size, title }: FichaProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" {...a11y} data-testid="ficha">
      <path d="M14 6h30l14 14v30a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8Z" fill={color} />
      <path d="M44 6v10a4 4 0 0 0 4 4h10Z" fill={shadow} />
      <rect x="21" y="23" width="6" height="11" rx="3" fill="var(--color-ficha-ink)" />
      <rect x="37" y="23" width="6" height="11" rx="3" fill="var(--color-ficha-ink)" />
      <circle cx="25" cy="26" r="1.2" fill="#fff" />
      <circle cx="41" cy="26" r="1.2" fill="#fff" />
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
    </svg>
  );
}
