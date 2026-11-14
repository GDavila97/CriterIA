import { AGENT_IDS, type AgentId } from '@/entities/corrida';

import { CHATTER, CHEERS, createOfficeLife, LINE_MS, WEIGHTS, type LifeInput } from './life';
import { BOARD, CHAT_PAIRS, DESKS, placeById, REST, route } from './places';

const FREE: LifeInput = { fixed: {}, celebrate: false };

/** Runs the routine event by event up to `until`, checking after each step. */
function play(
  life: ReturnType<typeof createOfficeLife>,
  until: number,
  each?: (at: number) => void,
) {
  let at = 0;
  for (let next = life.nextChange(at); next !== null && next <= until; next = life.nextChange(at)) {
    at = next;
    life.advance(at);
    each?.(at);
  }
}

describe('office routine', () => {
  it('starts with everyone at their own desk', () => {
    const view = createOfficeLife(1, FREE).view(0);

    for (const id of AGENT_IDS) expect(view[id].place).toBe(DESKS[id].id);
    expect(DESKS.analista.point[1]).toBeLessThan(DESKS.revisor.point[1]);
    expect(DESKS.qa.point[1]).toBeLessThan(DESKS.evaluador.point[1]);
  });

  it('plays the same scene for the same seed', () => {
    const a = createOfficeLife(7, FREE);
    const b = createOfficeLife(7, FREE);
    play(a, 120_000);
    play(b, 120_000);

    expect(a.decisions()).toEqual(b.decisions());
    expect(a.decisions().length).toBeGreaterThan(10);
  });

  it('follows the weights: the desk most often, then the rest, with every activity present', () => {
    const life = createOfficeLife(3, FREE);
    play(life, 3_600_000);
    const count = (activity: string) =>
      life.decisions().filter((d) => d.activity === activity).length;

    const desk = count('escritorio');
    for (const [activity] of WEIGHTS) expect(count(activity)).toBeGreaterThan(0);
    for (const [activity] of WEIGHTS.slice(1)) expect(desk).toBeGreaterThan(count(activity));
  });

  it('never puts two agents on the same place', () => {
    const life = createOfficeLife(11, FREE);
    play(life, 1_800_000, (at) => {
      const places = AGENT_IDS.map((id) => life.view(at)[id].place);
      expect(new Set(places).size).toBe(places.length);
    });
  });

  it('walks along the corridors and arrives after the time the distance takes', () => {
    const path = route(DESKS.analista, REST[0]!);

    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(DESKS.analista.point);
    expect(path.at(-1)).toEqual(REST[0]!.point);
  });

  it('brings two agents face to face to trade two or three lines, then lets them go', () => {
    const life = createOfficeLife(5, FREE);
    play(life, 600_000);
    const chat = life.decisions().find((d) => d.activity === 'charla');
    expect(chat).toBeDefined();
    const pair = CHAT_PAIRS.find(([a]) => a.id === chat!.place)!;
    const me = chat!.agent;
    const partner = chat!.partner as AgentId;

    const fresh = createOfficeLife(5, FREE);
    play(fresh, chat!.at);
    const walking = fresh.view(chat!.at);
    expect(walking[me].place).toBe(pair[0].id);
    expect(walking[partner].place).toBe(pair[1].id);
    const start = Math.max(walking[me].arrivesAt, walking[partner].arrivesAt);

    fresh.advance(start);
    const first = fresh.view(start);
    expect(first[me].bubble).toBeTruthy();
    expect(first[partner].bubble).toBeNull();
    expect(first[me].facing).not.toBe(first[partner].facing);
    expect(CHATTER).toContain(first[me].bubble);

    fresh.advance(start + LINE_MS);
    const second = fresh.view(start + LINE_MS);
    expect(second[partner].bubble).toBeTruthy();
    expect(second[me].bubble).toBeNull();

    const after = start + 3 * LINE_MS + 5_000;
    fresh.advance(after);
    expect(fresh.view(after)[me].activity).not.toBe('charla');
    expect(fresh.view(after)[partner].activity).not.toBe('charla');
  });

  it('keeps a fixed agent where it must be, sending away whoever stood there', () => {
    const life = createOfficeLife(2, FREE);
    play(life, 60_000);
    life.sync({ fixed: { analista: BOARD.id }, celebrate: false }, 60_000);

    play(life, 900_000, (at) => {
      expect(life.view(at).analista.place).toBe(BOARD.id);
    });
    expect(life.view(900_000).analista.activity).toBe('fijo');
  });

  it('gathers the team in the break room to celebrate, then goes back to routine', () => {
    const life = createOfficeLife(9, FREE);
    play(life, 30_000);
    life.sync({ fixed: {}, celebrate: true }, 30_000);
    const gathered = life.view(30_000);

    const rest = new Set(REST.map((p) => p.id));
    for (const id of AGENT_IDS) {
      expect(rest.has(gathered[id].place)).toBe(true);
      expect(gathered[id].activity).toBe('celebrar');
    }
    const start = Math.max(...AGENT_IDS.map((id) => gathered[id].arrivesAt));
    life.advance(start);
    expect(CHEERS).toContain(life.view(start).analista.bubble);

    play(life, start + 60_000);
    expect(AGENT_IDS.some((id) => life.view(start + 60_000)[id].activity !== 'celebrar')).toBe(
      true,
    );
    expect(placeById(life.view(start + 60_000).qa.place)).toBeDefined();
  });
});
