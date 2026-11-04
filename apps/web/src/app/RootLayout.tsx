import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { mono, sans } from './fonts';
import './styles/global.css';

export const rootMetadata: Metadata = {
  title: 'CriterIA',
  description:
    'Asistente multiagente que convierte requerimientos en historias de usuario, criterios de aceptación y casos de prueba.',
};

export const rootViewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export async function RootLayout({ children }: { children: ReactNode }) {
  // The nonce-based CSP only reaches the markup when every page renders per request.
  await connection();

  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
