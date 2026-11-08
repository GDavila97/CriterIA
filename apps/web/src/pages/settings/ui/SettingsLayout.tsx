'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Header, type HeaderUser } from '@/widgets/encabezado';

import styles from './SettingsLayout.module.css';

const SECTIONS = [
  { href: '/ajustes/modelos', label: 'Modelos y claves' },
  { href: '/ajustes/cuenta', label: 'Cuenta' },
  { href: '/ajustes/historial', label: 'Historial' },
  { href: '/privacidad', label: 'Privacidad y datos' },
];

export function SettingsLayout({
  user,
  title,
  lead,
  children,
}: {
  user: HeaderUser;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className={styles.page}>
      <Header user={user} />
      <div className={styles.layout}>
        <nav aria-label="Ajustes" className={styles.nav}>
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className={styles.navLink}
              aria-current={pathname === section.href ? 'page' : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <main className={styles.content}>
          <h1 className={styles.title}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}
