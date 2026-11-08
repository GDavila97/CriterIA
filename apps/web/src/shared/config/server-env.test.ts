import { getServerEnv } from './server-env';

describe('getServerEnv', () => {
  it('validates once and reuses the result', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(40));
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
    vi.stubEnv('AUTH_DATABASE_URL', 'postgresql://web_role:pw@127.0.0.1:5432/criteria');

    const first = getServerEnv();

    expect(first.EMAIL_PROVIDER).toBe('none');
    expect(getServerEnv()).toBe(first);
    vi.unstubAllEnvs();
  });
});
