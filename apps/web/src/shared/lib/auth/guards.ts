import { redirect } from 'next/navigation';

import { getSessionUser, type SessionUser } from './session';

/** For private pages: the proxy checks the cookie, this checks that the session is real. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/');
  return user;
}

export async function optionalUser(): Promise<SessionUser | null> {
  return getSessionUser();
}
