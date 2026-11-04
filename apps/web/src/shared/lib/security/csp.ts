export interface CspOptions {
  nonce: string;
  apiUrl: string;
  sentryDsn?: string | undefined;
  isDevelopment: boolean;
  upgradeInsecureRequests: boolean;
}

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const nonce = `'nonce-${options.nonce}'`;
  const connectSources = ["'self'", new URL(options.apiUrl).origin];
  if (options.sentryDsn) {
    connectSources.push(new URL(options.sentryDsn).origin);
  }
  // React needs eval only in development to rebuild server error stacks in the browser.
  const scriptSources = ["'self'", nonce, "'strict-dynamic'"];
  if (options.isDevelopment) {
    scriptSources.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    `style-src 'self' ${nonce}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.upgradeInsecureRequests) {
    directives.push('upgrade-insecure-requests');
  }
  return directives.join('; ');
}
