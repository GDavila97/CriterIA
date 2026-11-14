import { AGENT_IDS, type AgentId } from '@/entities/corrida';

import { iso, type Point3 } from './layout';

/** Corridor points; agents only walk between connected ones, so they never cross furniture. */
const NODES = {
  A1: [1.9, 3.3],
  A2: [3.4, 3.3],
  A3: [4.9, 3.3],
  A4: [7.0, 3.3],
  B1: [1.9, 5.95],
  B2: [3.4, 5.95],
  B3: [4.9, 5.95],
  B4: [7.0, 5.95],
  T: [6.9, 1.25],
  C1: [8.25, 0.8],
  C2: [8.25, 3.3],
  C3: [8.25, 5.95],
  J1: [9.0, 0.75],
  J2: [13.1, 0.75],
  J3: [13.1, 4.0],
  J4: [9.0, 4.0],
  D1: [10.3, 5.95],
  D2: [10.3, 8.05],
  D3: [12.5, 8.05],
  D4: [12.5, 5.95],
  D5: [13.3, 8.05],
  L1: [3.4, 8.0],
  L2: [6.2, 8.0],
} as const satisfies Record<string, readonly [number, number]>;

type NodeId = keyof typeof NODES;

const EDGES: readonly [NodeId, NodeId][] = [
  ['A1', 'A2'],
  ['A2', 'A3'],
  ['A3', 'A4'],
  ['B1', 'B2'],
  ['B2', 'B3'],
  ['B3', 'B4'],
  ['A2', 'B2'],
  ['A4', 'B4'],
  ['A4', 'T'],
  ['T', 'C1'],
  ['A4', 'C2'],
  ['B4', 'C3'],
  ['C1', 'C2'],
  ['C2', 'C3'],
  ['C1', 'J1'],
  ['J1', 'J2'],
  ['J2', 'J3'],
  ['J3', 'J4'],
  ['J4', 'J1'],
  ['J4', 'C2'],
  ['J4', 'D1'],
  ['J3', 'D4'],
  ['C3', 'D1'],
  ['D1', 'D2'],
  ['D2', 'D3'],
  ['D3', 'D4'],
  ['D4', 'D1'],
  ['D3', 'D5'],
  ['B2', 'L1'],
  ['B4', 'L2'],
  ['L1', 'L2'],
];

export type PlaceKind = 'escritorio' | 'trabajo' | 'tablero' | 'juntas' | 'descanso' | 'charla';

export interface Place {
  id: string;
  kind: PlaceKind;
  point: Point3;
  /** The corridor point it is reached from in a straight line. */
  node: NodeId;
  /** A desk belongs to one agent. */
  owner?: AgentId;
}

const place = (
  id: string,
  kind: PlaceKind,
  [x, y]: readonly [number, number],
  node: NodeId,
  owner?: AgentId,
): Place => ({ id, kind, point: [x, y, 0], node, owner });

/** Analista and QA sit at the back desks, Revisor and Evaluador at the front ones. */
export const DESKS: Record<AgentId, Place> = {
  analista: place('escritorio-analista', 'escritorio', [1.9, 2.85], 'A1', 'analista'),
  qa: place('escritorio-qa', 'escritorio', [4.9, 2.85], 'A3', 'qa'),
  revisor: place('escritorio-revisor', 'escritorio', [1.9, 5.45], 'B1', 'revisor'),
  evaluador: place('escritorio-evaluador', 'escritorio', [4.9, 5.45], 'B3', 'evaluador'),
};

/** Where each agent does its real work: the writers at their desks, the others in the meeting room. */
export const WORK: Record<AgentId, Place> = {
  analista: DESKS.analista,
  qa: DESKS.qa,
  revisor: place('trabajo-revisor', 'trabajo', [11.0, 3.85], 'J4'),
  evaluador: place('trabajo-evaluador', 'trabajo', [12.7, 3.8], 'J3'),
};

export const BOARD = place('tablero', 'tablero', [6.6, 1.1], 'T');

const MEETING: Place[] = [
  place('juntas-1', 'juntas', [9.9, 0.75], 'J1'),
  place('juntas-2', 'juntas', [12.2, 0.75], 'J2'),
];

/** Break-room points far enough apart on screen that two agents never overlap. */
export const REST: Place[] = [
  place('descanso-1', 'descanso', [9.2, 5.8], 'D1'),
  place('descanso-2', 'descanso', [11.0, 5.8], 'D1'),
  place('descanso-3', 'descanso', [13.3, 7.1], 'D5'),
  place('descanso-4', 'descanso', [13.3, 9.3], 'D5'),
  place('descanso-5', 'descanso', [10.6, 8.0], 'D2'),
];

/** Two agents chat face to face on each pair of points, in the open floor by the desks. */
export const CHAT_PAIRS: [Place, Place][] = [
  [place('charla-1a', 'charla', [2.5, 8.0], 'L1'), place('charla-1b', 'charla', [4.3, 8.0], 'L1')],
  [place('charla-2a', 'charla', [6.1, 7.8], 'L2'), place('charla-2b', 'charla', [7.9, 7.8], 'L2')],
];

export const PLACES: readonly Place[] = [
  ...AGENT_IDS.map((id) => DESKS[id]),
  WORK.revisor,
  WORK.evaluador,
  BOARD,
  ...MEETING,
  ...REST,
  ...CHAT_PAIRS.flat(),
];

const byId = new Map(PLACES.map((p) => [p.id, p]));

export function placeById(id: string): Place {
  const found = byId.get(id);
  if (!found) throw new Error(`Unknown office place ${id}`);
  return found;
}

/** Distance as it looks on screen, in scene units, so walking speed is the same in any direction. */
export function screenDistance(a: Point3, b: Point3): number {
  const [ax, ay] = iso(a);
  const [bx, by] = iso(b);
  return Math.hypot(bx - ax, by - ay);
}

const nodePoint = (id: NodeId): Point3 => [NODES[id][0], NODES[id][1], 0];

const neighbours = new Map<NodeId, NodeId[]>();
for (const [a, b] of EDGES) {
  neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
}

function shortestNodes(from: NodeId, to: NodeId): NodeId[] {
  const distance = new Map<NodeId, number>([[from, 0]]);
  const previous = new Map<NodeId, NodeId>();
  const open = new Set<NodeId>([from]);
  while (open.size) {
    const current = [...open].reduce((a, b) =>
      (distance.get(a) ?? Infinity) <= (distance.get(b) ?? Infinity) ? a : b,
    );
    open.delete(current);
    if (current === to) break;
    for (const next of neighbours.get(current) ?? []) {
      const d = (distance.get(current) ?? 0) + screenDistance(nodePoint(current), nodePoint(next));
      if (d < (distance.get(next) ?? Infinity)) {
        distance.set(next, d);
        previous.set(next, current);
        open.add(next);
      }
    }
  }
  const path: NodeId[] = [to];
  while (path[0] !== from) {
    const step = previous.get(path[0]!);
    if (!step) return [from, to];
    path.unshift(step);
  }
  return path;
}

/** The points an agent walks through from one place to another, along the corridors. */
export function route(from: Place, to: Place): Point3[] {
  if (from.id === to.id) return [from.point];
  const points = [from.point, ...shortestNodes(from.node, to.node).map(nodePoint), to.point];
  return points.filter((point, i) => i === 0 || screenDistance(point, points[i - 1]!) > 1);
}

export function routeLength(points: readonly Point3[]): number {
  return points.reduce((sum, point, i) => (i ? sum + screenDistance(points[i - 1]!, point) : 0), 0);
}
