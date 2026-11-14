import { CHATTER, createIdlePlanner, seededRandom } from './idle';

const OPEN = [0, 1, 2, 3, 4];

describe('idle planner', () => {
  it('plays the same scene for the same seed', () => {
    const run = (seed: number) => {
      const planner = createIdlePlanner(seed);
      return Array.from({ length: 12 }, () => [
        planner.pause(),
        planner.next(['qa', 'revisor'], OPEN),
      ]);
    };

    expect(run(7)).toEqual(run(7));
    expect(run(8)).not.toEqual(run(7));
  });

  it('waits a calm while, picks only free agents, walks to open spots and says friendly lines', () => {
    const planner = createIdlePlanner(3);
    for (let i = 0; i < 60; i += 1) {
      const pause = planner.pause();
      const step = planner.next(['analista', 'evaluador'], [1, 4]);
      expect(pause).toBeGreaterThanOrEqual(2_500);
      expect(pause).toBeLessThanOrEqual(6_000);
      expect(['analista', 'evaluador']).toContain(step!.agent);
      if (step!.kind === 'caminar') expect([1, 4]).toContain(step!.spot);
      else expect(CHATTER).toContain(step!.texto);
    }
  });

  it('only talks when every spot is taken, and does nothing while nobody is free', () => {
    const planner = createIdlePlanner(9);
    const steps = Array.from({ length: 20 }, () => planner.next(['qa'], []));

    expect(steps.every((s) => s?.kind === 'decir')).toBe(true);
    expect(createIdlePlanner(1).next([], OPEN)).toBeNull();
  });

  it('draws numbers between 0 and 1', () => {
    const random = seededRandom(42);
    const values = Array.from({ length: 100 }, random);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
