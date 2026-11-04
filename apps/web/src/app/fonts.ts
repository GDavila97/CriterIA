import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

// next/font downloads the files at build time and serves them from this origin.
export const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plus-jakarta-sans',
});

export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});
