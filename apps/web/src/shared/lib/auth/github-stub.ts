const GITHUB_HOSTS = new Set(['github.com', 'api.github.com']);

/**
 * End-to-end tests only: sends the server's calls to GitHub to a local stub, so Better Auth's
 * real GitHub provider runs without the network. The server env refuses it outside tests.
 */
export function routeGithubToStub(stubUrl: string, target: typeof globalThis = globalThis): void {
  const original = target.fetch.bind(target);
  target.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!GITHUB_HOSTS.has(url.hostname)) return original(input, init);
    const stub = new URL(stubUrl);
    stub.pathname = `/${url.hostname}${url.pathname}`;
    stub.search = url.search;
    return original(input instanceof Request ? new Request(stub, input) : stub, init);
  };
}
