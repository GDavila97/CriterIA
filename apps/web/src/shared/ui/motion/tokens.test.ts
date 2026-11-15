import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'tokens.css'), 'utf8');
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

describe('motion tokens', () => {
  it('keep every transition between 150 and 250 ms', () => {
    const durations = [...css.matchAll(/--duration-[a-z]+:\s*(\d+)ms/g)].map((m) => Number(m[1]));

    expect(durations).toHaveLength(3);
    for (const ms of durations) {
      expect(ms).toBeGreaterThanOrEqual(150);
      expect(ms).toBeLessThanOrEqual(250);
    }
  });

  it('leave only opacity with reduced motion: no distance, no scale', () => {
    const block = reduced.slice(0, reduced.indexOf('}\n}') + 3);

    expect(block).toMatch(/--motion-shift:\s*0px/);
    expect(block).toMatch(/--motion-lift:\s*0px/);
    expect(block).toMatch(/--motion-slide:\s*0px/);
    expect(block).toMatch(/--motion-press:\s*1;/);
  });
});
