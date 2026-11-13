import { redirect } from 'next/navigation';

import { getServerEnv } from '@/shared/config/server-env';
import { optionalUser } from '@/shared/lib/auth/guards';

import { HomePage } from './HomePage';

interface Search {
  error?: string;
  cuenta?: string;
}

export async function HomeRoute({ searchParams }: { searchParams: Promise<Search> }) {
  if (await optionalUser()) redirect('/analisis');
  const env = getServerEnv();
  const params = await searchParams;
  return (
    <HomePage
      githubEnabled={Boolean(env.GITHUB_CLIENT_ID)}
      emailMode={env.EMAIL_PROVIDER}
      oauthError={params.error ?? null}
      accountDeleted={params.cuenta === 'eliminada'}
    />
  );
}
