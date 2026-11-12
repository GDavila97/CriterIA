import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

import { getServerEnv } from '@/shared/config/server-env';

import { routeGithubToStub } from './github-stub';
import { getAuth } from './server';

vi.mock('better-auth', () => ({ betterAuth: vi.fn((options) => ({ options })) }));
vi.mock('pg', () => ({ Pool: vi.fn(function Pool() {}) }));
vi.mock('./github-stub', () => ({ routeGithubToStub: vi.fn() }));
vi.mock('@/shared/config/server-env', () => ({ getServerEnv: vi.fn() }));

describe('getAuth', () => {
  it('builds Better Auth once without connection options and routes GitHub to the stub in tests', () => {
    vi.mocked(getServerEnv).mockReturnValue({
      NEXT_PUBLIC_APP_ENV: 'test',
      BETTER_AUTH_SECRET: 's'.repeat(40),
      BETTER_AUTH_URL: 'http://localhost:3000',
      AUTH_DATABASE_URL: 'postgresql://web_role:pw@127.0.0.1:5432/criteria',
      EMAIL_PROVIDER: 'none',
      GITHUB_STUB_URL: 'http://127.0.0.1:4010',
    } as never);

    const first = getAuth();

    expect(getAuth()).toBe(first);
    expect(betterAuth).toHaveBeenCalledTimes(1);
    expect(Pool).toHaveBeenCalledWith({
      connectionString: 'postgresql://web_role:pw@127.0.0.1:5432/criteria',
    });
    expect(routeGithubToStub).toHaveBeenCalledWith('http://127.0.0.1:4010');
  });
});
