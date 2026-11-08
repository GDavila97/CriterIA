const PATHS = {
  lapiz: 'M4 20h4L19 9l-4-4L4 16v4Zm11-15 4 4',
  palomita: 'm5 12 4.5 4.5L19 7',
  lupa: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  estrella: 'm12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8L12 4Z',
  alerta: 'M12 8v5m0 3.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  info: 'M12 11v5m0-8.5V8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  candado: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9Z',
  cerrar: 'm6 6 12 12M18 6 6 18',
  atras: 'M15 5 8 12l7 7',
  abajo: 'm6 9 6 6 6-6',
  derecha: 'm9 5 7 7-7 7',
  flecha: 'M5 12h14m-5-5 5 5-5 5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  mas: 'M12 5v14M5 12h14',
  descargar: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  size?: number;
  label?: string;
}

/** Stroke icons in SVG; decorative unless a label is given. */
export function Icon({ name, size = 20, label }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
