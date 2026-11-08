import Link from 'next/link';

import { Ficha } from '../ficha/Ficha';

import styles from './Logo.module.css';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className={styles.logo} aria-label="CriterIA, inicio">
      <Ficha
        color="var(--color-accent-strong)"
        shadow="color-mix(in srgb, var(--color-accent-strong) 62%, var(--color-ficha-ink))"
        size={30}
      />
      <span aria-hidden="true">
        Criter<span className={styles.accent}>IA</span>
      </span>
    </Link>
  );
}
