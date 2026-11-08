import styles from './Skeleton.module.css';

// The size goes in SVG attributes because the CSP forbids inline style attributes.
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return (
    <svg
      className={styles.block}
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
    />
  );
}

/** Placeholder card with the shape of what is loading, so nothing jumps when data arrives. */
export function SkeletonCard({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className={styles.card} role="status" aria-label={label}>
      <Skeleton height={24} width="40%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={44} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}
