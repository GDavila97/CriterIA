import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/shared/config';
import { buildContentSecurityPolicy, createNonce, isPrivatePath } from '@/shared/lib/security';

export function proxy(request: NextRequest) {
  // Only a quick cookie check; each private page still validates the session on the server.
  if (isPrivatePath(request.nextUrl.pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const policy = buildContentSecurityPolicy({
    nonce: createNonce(),
    apiUrl: publicEnv.NEXT_PUBLIC_API_URL,
    sentryDsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    isDevelopment: process.env.NODE_ENV === 'development',
    upgradeInsecureRequests: publicEnv.NEXT_PUBLIC_APP_ENV === 'production',
  });

  // Next.js reads the nonce from the request CSP header and stamps it on its own tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
