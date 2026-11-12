import { routeGithubToStub } from './github-stub';

describe('routeGithubToStub', () => {
  it('sends only GitHub calls to the stub and keeps the rest untouched', async () => {
    const calls: string[] = [];
    const target = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        calls.push(input instanceof Request ? input.url : input.toString());
        return new Response('{}');
      }),
    } as unknown as typeof globalThis;

    routeGithubToStub('http://127.0.0.1:4010', target);
    await target.fetch('https://github.com/login/oauth/access_token?x=1', { method: 'POST' });
    await target.fetch(new Request('https://api.github.com/user/emails'));
    await target.fetch('http://localhost:8080/health');

    expect(calls).toEqual([
      'http://127.0.0.1:4010/github.com/login/oauth/access_token?x=1',
      'http://127.0.0.1:4010/api.github.com/user/emails',
      'http://localhost:8080/health',
    ]);
  });
});
