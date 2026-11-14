import type { AgentId } from '@/entities/corrida';

/** Isometric floor coordinates, in tiles; z is height. The scene is drawn from these once. */
type Point3 = readonly [x: number, y: number, z: number];

const UNIT = 44;
const ORIGIN_X = 610;
const ORIGIN_Y = 250;
const HEIGHT_SCALE = 0.85;

export function iso([x, y, z]: Point3): [number, number] {
  return [ORIGIN_X + (x - y) * UNIT, ORIGIN_Y + ((x + y) * UNIT) / 2 - z * UNIT * HEIGHT_SCALE];
}

export interface Shape {
  points: string;
  fill: string;
}

type Palette = readonly [top: string, front: string, side: string];

const polygon = (corners: Point3[], fill: string): Shape => ({
  points: corners
    .map(iso)
    .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
    .join(' '),
  fill,
});

function box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c: Palette) {
  return [
    polygon(
      [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      c[1],
    ),
    polygon(
      [
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
      c[2],
    ),
    polygon(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      c[0],
    ),
  ];
}

const tile = (x0: number, y0: number, x1: number, y1: number, fill: string) =>
  polygon(
    [
      [x0, y0, 0.01],
      [x1, y0, 0.01],
      [x1, y1, 0.01],
      [x0, y1, 0.01],
    ],
    fill,
  );

const WALL: Palette = ['#f7f5f0', '#e6e1d6', '#d6d0c3'];
const WOOD: Palette = ['#c9965f', '#a97845', '#8e6236'];
const DARK: Palette = ['#4a505c', '#363b45', '#2a2e36'];
const SOFA: Palette = ['#9fb3e8', '#7f95d1', '#6c82be'];

/** Walls, floor, rooms and furniture, back to front. */
export const SCENE: readonly Shape[] = [
  ...box(-0.35, -0.35, 14, 0, 0, 2.4, WALL),
  ...box(-0.35, 0, 0, 10, 0, 2.4, WALL),
  ...box(0, 0, 14, 10, -0.5, 0, ['#dadde3', '#c3c8d0', '#aeb4be']),
  tile(0.3, 0.3, 8, 6, '#d3e1f6'),
  tile(8.5, 0.3, 13.7, 5, '#e5dcf6'),
  tile(8.5, 5.5, 13.7, 9.7, '#f6e3ce'),
  tile(0.3, 6.5, 8, 9.7, '#e2e6ec'),
  ...box(5.2, -0.3, 7.8, -0.05, 0.9, 2.0, ['#2b2f38', '#2b2f38', '#2b2f38']),
  ...box(1, 1.2, 2.8, 2.2, 0, 0.9, WOOD),
  ...box(4, 1.2, 5.8, 2.2, 0, 0.9, WOOD),
  ...box(1, 3.8, 2.8, 4.8, 0, 0.9, WOOD),
  ...box(4, 3.8, 5.8, 4.8, 0, 0.9, WOOD),
  ...box(1.5, 1.3, 2.3, 1.45, 0.9, 1.5, DARK),
  ...box(4.5, 1.3, 5.3, 1.45, 0.9, 1.5, DARK),
  ...box(9.5, 1.2, 12.5, 3.2, 0, 0.8, ['#edeff3', '#cdd2da', '#b8bec9']),
  ...box(9, 6.2, 9.8, 9.2, 0, 0.7, SOFA),
  ...box(9.8, 8.4, 12.6, 9.2, 0, 0.7, SOFA),
  ...box(12.9, 5.9, 13.6, 6.6, 0, 1.3, DARK),
  ...box(10.8, 6.6, 12, 7.6, 0, 0.45, WOOD),
];

export type Zona = 'escritorios' | 'juntas' | 'tablero' | 'descanso';

export const ZONE_LABELS: Record<Zona, { label: string; at: Point3 }> = {
  escritorios: { label: 'Escritorios', at: [4.2, 5.6, 0] },
  juntas: { label: 'Sala de juntas', at: [13.1, 1.0, 0] },
  descanso: { label: 'Sala de descanso', at: [9.0, 9.9, 0] },
  tablero: { label: 'Tablero', at: [6.5, -0.3, 2.35] },
};

/** Where each agent stands for each kind of work. */
export const WORK_SPOTS: Record<AgentId, Point3> = {
  analista: [1.9, 2.9, 0],
  qa: [4.9, 2.9, 0],
  revisor: [11, 3.8, 0],
  evaluador: [12.4, 3.6, 0],
};

export const BOARD_SPOT: Point3 = [6.6, 1.1, 0];

/**
 * Points in the break room, far enough apart on screen that two agents never overlap there.
 * The first four are each agent's usual place; the fifth leaves room to move.
 */
export const REST_SPOTS: readonly Point3[] = [
  [9.2, 5.8, 0],
  [11.2, 5.8, 0],
  [13.2, 7.8, 0],
  [13.0, 9.4, 0],
  [10.6, 8.0, 0],
];

export const HOME_REST: Record<AgentId, number> = { analista: 0, qa: 1, revisor: 2, evaluador: 3 };

const corners = SCENE.flatMap((s) => s.points.split(' ').map((p) => p.split(',').map(Number)));
const PAD = 24;
const minX = Math.min(...corners.map((c) => c[0]!)) - PAD;
const minY = Math.min(...corners.map((c) => c[1]!)) - PAD * 3;
const maxX = Math.max(...corners.map((c) => c[0]!)) + PAD;
const maxY = Math.max(...corners.map((c) => c[1]!)) + PAD;

/** The scene's box; the extra room on top leaves space for the bubbles over the back desks. */
export const VIEW = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

/** A floor point as a percentage of the scene box, for placing HTML over the SVG. */
export function toPercent(point: Point3): { x: number; y: number } {
  const [px, py] = iso(point);
  return { x: ((px - VIEW.x) / VIEW.width) * 100, y: ((py - VIEW.y) / VIEW.height) * 100 };
}

export type { Point3 };
