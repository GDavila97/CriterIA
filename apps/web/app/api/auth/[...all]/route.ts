import { toNextJsHandler } from 'better-auth/next-js';

import { withFirstForwardedIp } from '@/shared/lib/auth/client-ip';
import { getAuth } from '@/shared/lib/auth/server';

export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(withFirstForwardedIp(request));
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(withFirstForwardedIp(request));
}
