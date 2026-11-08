import { notFound } from 'next/navigation';

import { getServerEnv } from '@/shared/config/server-env';

import { RecoverPage, ResetPage } from './RecoveryPages';

/** Recovery exists only while the web can send email (ADR 0020). */
function requireEmail(): void {
  if (getServerEnv().EMAIL_PROVIDER === 'none') notFound();
}

export function RecoverRoute() {
  requireEmail();
  return <RecoverPage />;
}

export async function ResetRoute({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  requireEmail();
  const { token } = await searchParams;
  return <ResetPage token={token ?? null} />;
}
