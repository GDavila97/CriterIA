import { createAccountLimiter } from './account-limit';

describe('createAccountLimiter', () => {
  it('counts per hashed account and refuses past the maximum', async () => {
    const counts = [1, 2, 3];
    const query = vi.fn(async () => ({ rows: [{ count: String(counts.shift() ?? 9) }] }));
    const allow = createAccountLimiter({ query }, { windowSeconds: 900, max: 2 }, () => 1_000_000);

    const results = [
      await allow('Ana@Example.test '),
      await allow('ana@example.test'),
      await allow('ana@example.test'),
    ];

    expect(results).toEqual([true, true, false]);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (key)');
    expect(values[1]).toMatch(/^account:[0-9a-f]{64}$/);
    expect(JSON.stringify(values)).not.toContain('ana@example.test');
    expect(values.slice(2)).toEqual([1_000_000, 100_000]);
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1][1]).toBe(values[1]);
  });

  it('allows the attempt when the database returns no count', async () => {
    const allow = createAccountLimiter(
      { query: async () => ({ rows: [] }) },
      { windowSeconds: 1, max: 0 },
    );

    expect(await allow('a@b.c')).toBe(true);
  });
});
