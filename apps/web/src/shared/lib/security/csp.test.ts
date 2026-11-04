import { buildContentSecurityPolicy, createNonce, type CspOptions } from './csp';

const base: CspOptions = {
  nonce: 'abc123',
  apiUrl: 'https://api.example.test/v1',
  isDevelopment: false,
  upgradeInsecureRequests: true,
};

function directive(policy: string, name: string): string {
  return policy.split('; ').find((entry) => entry.startsWith(`${name} `)) ?? '';
}

describe('buildContentSecurityPolicy', () => {
  it('allows scripts and styles only by nonce in production', () => {
    const policy = buildContentSecurityPolicy(base);

    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'nonce-abc123'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('adds unsafe-eval to scripts only in development', () => {
    const policy = buildContentSecurityPolicy({ ...base, isDevelopment: true });

    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
  });

  it('limits connections to self, the API origin and the Sentry ingest origin', () => {
    const policy = buildContentSecurityPolicy({
      ...base,
      sentryDsn: 'https://public@o1.ingest.us.sentry.io/42',
    });

    expect(directive(policy, 'connect-src')).toBe(
      "connect-src 'self' https://api.example.test https://o1.ingest.us.sentry.io",
    );
  });

  it('forbids framing, plugins, foreign base URIs and foreign form targets', () => {
    const policy = buildContentSecurityPolicy(base);

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it('upgrades insecure requests only when asked', () => {
    expect(buildContentSecurityPolicy(base)).toContain('upgrade-insecure-requests');
    expect(buildContentSecurityPolicy({ ...base, upgradeInsecureRequests: false })).not.toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('createNonce', () => {
  it('returns a different base64 value on each call', () => {
    const first = createNonce();

    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(createNonce()).not.toBe(first);
  });
});
