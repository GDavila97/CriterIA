import { publicEnv } from '@/shared/config';
import { requireUser } from '@/shared/lib/auth/guards';

import { RunWorkspace } from './RunWorkspace';

export async function RunRoute({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const user = await requireUser();
  const { vista } = await searchParams;
  return (
    <RunWorkspace
      user={{ name: user.name, email: user.email }}
      officeEnabled={publicEnv.NEXT_PUBLIC_OFFICE_VIEW}
      vistaParam={vista ?? null}
    />
  );
}
