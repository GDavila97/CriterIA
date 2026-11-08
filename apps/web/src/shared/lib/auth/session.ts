import { headers } from 'next/headers';

import { getAuth } from './server';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** How the person signs in: "credential", "github", "google". */
  providers: string[];
}

/** The signed-in person for server components, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const requestHeaders = await headers();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
  const { id, name, email, emailVerified } = session.user;
  return { id, name, email, emailVerified, providers: accounts.map((a) => a.providerId) };
}
