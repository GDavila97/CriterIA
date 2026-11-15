import type { Speaker, TeamMessage } from './conversation';
import { isCorrection } from './conversation';

/** Top to bottom, as the team hands work down: you, then the agents in the order they appear. */
export const LANES: readonly Speaker[] = ['tu', 'analista', 'revisor', 'qa', 'evaluador'];

export const DIAGRAM = {
  laneHeight: 92,
  /** Room on the left for each lane's name. */
  labelWidth: 150,
  column: 146,
  nodeWidth: 128,
  nodeHeight: 60,
  /** Space on the right so the last node's shadow is not cut. */
  end: 24,
} as const;

export interface DiagramNode {
  message: TeamMessage;
  lane: number;
  x: number;
  y: number;
  /** "R2" for steps of a correction round. */
  round: string | null;
}

export interface DiagramEdge {
  id: string;
  kind: 'entrega' | 'correccion';
  /** A cubic curve from the right edge of one step to the left edge of the next. */
  path: string;
  arrow: string;
  /** Where the "corrección" label sits, on the curve's middle. */
  label: { x: number; y: number } | null;
}

export interface DiagramLayout {
  width: number;
  height: number;
  lanes: { id: Speaker; y: number }[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const ARROW = 8;

function edge(id: string, a: DiagramNode, b: DiagramNode, correction: boolean): DiagramEdge {
  const { nodeWidth, nodeHeight } = DIAGRAM;
  const x1 = a.x + nodeWidth;
  const y1 = a.y + nodeHeight / 2;
  const x2 = b.x - 2;
  const y2 = b.y + nodeHeight / 2;
  const bend = Math.max((x2 - x1) * 0.6, 12);
  return {
    id,
    kind: correction ? 'correccion' : 'entrega',
    path: `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - ARROW + 1} ${y2}`,
    arrow: `${x2},${y2} ${x2 - ARROW},${y2 - 5} ${x2 - ARROW},${y2 + 5}`,
    label: correction ? { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } : null,
  };
}

/** The next step of whoever a message was for; the team and errors have none. */
function nextStepOf(nodes: readonly DiagramNode[], from: number): DiagramNode | null {
  const to = nodes[from]!.message.to;
  if (!to || to === 'equipo') return null;
  return nodes.slice(from + 1).find((n) => n.message.from === to) ?? null;
}

/**
 * Lanes for you and each agent, time from left to right and one step per message. Each message
 * points to the next step of whoever it was for: amber when the Reviewer asks for a correction,
 * so corrections sent to two agents at once reach each of them.
 */
export function diagramLayout(messages: readonly TeamMessage[]): DiagramLayout {
  const { laneHeight, labelWidth, column, nodeWidth, nodeHeight, end } = DIAGRAM;
  const nodes = messages.map((message, i): DiagramNode => {
    const lane = LANES.indexOf(message.from);
    return {
      message,
      lane,
      x: labelWidth + i * column + (column - nodeWidth) / 2,
      y: lane * laneHeight + (laneHeight - nodeHeight) / 2,
      round: message.ronda > 0 ? `R${message.ronda + 1}` : null,
    };
  });
  const edges = nodes.flatMap((node, i) => {
    const target = nextStepOf(nodes, i);
    return target ? [edge(`e-${i}`, node, target, isCorrection(node.message))] : [];
  });
  return {
    width: labelWidth + Math.max(nodes.length, 1) * column + end,
    height: LANES.length * laneHeight,
    lanes: LANES.map((id, i) => ({ id, y: i * laneHeight })),
    nodes,
    edges,
  };
}

/** The steps that mention any of the same stories, cases or observations as this one. */
export function relatedSteps(messages: readonly TeamMessage[], selected: TeamMessage): Set<string> {
  const ids = new Set(selected.refs.map((r) => r.id));
  return new Set(
    messages
      .filter((m) => m.id !== selected.id && m.refs.some((r) => ids.has(r.id)))
      .map((m) => m.id),
  );
}
