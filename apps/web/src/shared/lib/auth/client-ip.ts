const FORWARDED_FOR = 'x-forwarded-for';

/**
 * Leaves only the first address of X-Forwarded-For, the client as Vercel writes it.
 * Better Auth ignores a header with several addresses, which would put everyone in one bucket.
 */
export function withFirstForwardedIp(request: Request): Request {
  const forwarded = request.headers.get(FORWARDED_FOR);
  if (forwarded === null) return request;
  const first = forwarded.split(',')[0]?.trim() ?? '';
  if (first === forwarded) return request;

  const headers = new Headers(request.headers);
  if (first) {
    headers.set(FORWARDED_FOR, first);
  } else {
    headers.delete(FORWARDED_FOR);
  }
  return new Request(request, { headers });
}
