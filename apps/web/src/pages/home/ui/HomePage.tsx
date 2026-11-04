import { Ficha } from '@/shared/ui';

import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <Ficha
          color="var(--color-accent)"
          shadow="color-mix(in srgb, var(--color-accent) 62%, var(--color-ficha-ink))"
          size={96}
        />
        <h1 className={styles.name}>CriterIA</h1>
      </div>
    </main>
  );
}
