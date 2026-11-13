'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { runSession } from '@/entities/corrida';
import { UnsavedRunDialog, useLeaveWarning, useLossGuard } from '@/features/exportar';
import { apiToken } from '@/shared/api';
import { authClient } from '@/shared/lib/auth/client';
import { Icon, Logo } from '@/shared/ui';

import styles from './Header.module.css';

export interface HeaderUser {
  name: string;
  email: string;
}

export interface HeaderProps {
  user: HeaderUser | null;
  /** Shown next to the account menu, for example the view switch on the run page. */
  actions?: ReactNode;
}

const LINKS = [
  { href: '/corrida', label: 'Nueva corrida' },
  { href: '/historial', label: 'Historial' },
  { href: '/evaluacion', label: 'Evaluación' },
  { href: '/ajustes', label: 'Ajustes' },
];

export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : (words[0] ?? email).slice(0, 2);
  return letters.toUpperCase();
}

function PublicHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Logo />
        <div className={styles.end}>
          <Link href="/evaluacion" className={styles.publicLink}>
            Evaluación pública
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Header({ user, actions }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const lossGuard = useLossGuard();
  useLeaveWarning();

  if (!user) return <PublicHeader />;

  const signOut = async () => {
    await authClient.signOut();
    apiToken.clear();
    // The next person in this tab must not see the analysis.
    runSession.clear();
    router.push('/');
    router.refresh();
  };

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Logo href="/corrida" />
        <nav aria-label="Principal" className={styles.nav} id="main-nav" data-open={navOpen}>
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={styles.navLink}
              aria-current={pathname?.startsWith(link.href) ? 'page' : undefined}
              onClick={() => setNavOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className={styles.end}>
          {actions}
          <div className={styles.account}>
            <button
              type="button"
              className={styles.iconButton}
              aria-expanded={menuOpen}
              aria-controls="account-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">{initials(user.name, user.email)}</span>
              <span className="sr-only">Cuenta de {user.name || user.email}</span>
            </button>
            {menuOpen && (
              <div id="account-menu" className={styles.menu}>
                <span className={styles.menuName}>{user.email}</span>
                <Link
                  href="/ajustes/cuenta"
                  className={styles.menuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Cuenta
                </Link>
                <Link
                  href="/privacidad"
                  className={styles.menuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Privacidad y datos
                </Link>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    lossGuard.guard(() => void signOut());
                  }}
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.mobileToggle}`}
            aria-label="Menú"
            aria-expanded={navOpen}
            aria-controls="main-nav"
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon name={navOpen ? 'cerrar' : 'menu'} />
          </button>
        </div>
      </div>
      <UnsavedRunDialog guard={lossGuard} />
    </header>
  );
}
