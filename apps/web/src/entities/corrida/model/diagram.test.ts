import {
  caso,
  delivers,
  eventsFrom,
  fullRun,
  historia,
  inicia,
  observacion,
} from '@/shared/lib/testing';

import { teamMessages } from './conversation';
import { DIAGRAM, diagramLayout, LANES, relatedSteps } from './diagram';

describe('diagramLayout', () => {
  const messages = teamMessages(fullRun());
  const layout = diagramLayout(messages);

  it('puts one step per message in its speaker lane, time from left to right', () => {
    expect(LANES).toEqual(['tu', 'analista', 'revisor', 'qa', 'evaluador']);
    expect(layout.nodes.map((n) => LANES[n.lane])).toEqual([
      'analista',
      'tu',
      'qa',
      'revisor',
      'qa',
      'revisor',
      'evaluador',
    ]);
    const xs = layout.nodes.map((n) => n.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[1]! - xs[0]!).toBe(DIAGRAM.column);
    expect(layout.nodes[0]!.y).toBe(
      DIAGRAM.laneHeight + (DIAGRAM.laneHeight - DIAGRAM.nodeHeight) / 2,
    );
    expect(layout.width).toBe(DIAGRAM.labelWidth + 7 * DIAGRAM.column + DIAGRAM.end);
    expect(layout.height).toBe(5 * DIAGRAM.laneHeight);
  });

  it('draws gray hand-offs and an amber, labeled arrow after a correction', () => {
    expect(layout.edges.map((e) => e.kind)).toEqual([
      'entrega',
      'entrega',
      'entrega',
      'correccion',
      'entrega',
      'entrega',
    ]);
    const fix = layout.edges[3]!;
    const [from, to] = [layout.nodes[3]!, layout.nodes[4]!];
    expect(
      fix.path.startsWith(`M${from.x + DIAGRAM.nodeWidth} ${from.y + DIAGRAM.nodeHeight / 2}`),
    ).toBe(true);
    expect(fix.arrow.startsWith(`${to.x - 2},${to.y + DIAGRAM.nodeHeight / 2}`)).toBe(true);
    expect(fix.label).toEqual({
      x: (from.x + DIAGRAM.nodeWidth + to.x - 2) / 2,
      y: (from.y + to.y + DIAGRAM.nodeHeight) / 2,
    });
    expect(layout.edges[0]!.label).toBeNull();
  });

  it('sends each correction to its own agent when the Reviewer asks two at once', () => {
    const both = teamMessages(
      eventsFrom(
        inicia,
        {
          type: 'revisor_observa',
          agent: 'revisor',
          ronda: 0,
          observaciones: [observacion('analista'), observacion('qa')],
          se_corrige: true,
        },
        delivers('analista', { tipo: 'historias', historias: [historia(1)] }, 1),
        delivers('qa', { tipo: 'pruebas', criterios: [], casos: [caso(1)] }, 1),
      ),
    );
    const { edges, nodes } = diagramLayout(both);
    const target = (e: (typeof edges)[number]) =>
      nodes.findIndex((n) => e.arrow.startsWith(`${n.x - 2},`));

    expect(both.map((m) => [m.from, m.to])).toEqual([
      ['revisor', 'analista'],
      ['revisor', 'qa'],
      ['analista', 'qa'],
      ['qa', 'revisor'],
    ]);
    expect(edges.map((e) => [e.id, e.kind, target(e)])).toEqual([
      ['e-0', 'correccion', 2],
      ['e-1', 'correccion', 3],
      ['e-2', 'entrega', 3],
    ]);
  });

  it('marks the steps of a correction round', () => {
    expect(layout.nodes.map((n) => n.round)).toEqual([null, null, null, null, 'R2', 'R2', null]);
  });

  it('keeps an empty diagram one column wide', () => {
    const empty = diagramLayout([]);
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.width).toBe(DIAGRAM.labelWidth + DIAGRAM.column + DIAGRAM.end);
  });

  it('finds the steps that mention the same artifacts', () => {
    const correction = messages[3]!;
    expect([...relatedSteps(messages, correction)]).toEqual([messages[0]!.id]);
    const withStory = {
      ...messages[1]!,
      refs: [{ kind: 'historia' as const, id: 'HU-1', label: 'HU-1' }],
    };
    expect([...relatedSteps([messages[0]!, withStory], messages[0]!)]).toEqual([withStory.id]);
  });
});
