import { requireUser } from '@/shared/lib/auth/guards';

import { HistoryPage } from './HistoryPage';

export async function HistoryRoute() {
  const user = await requireUser();
  return <HistoryPage user={{ name: user.name, email: user.email }} />;
}
