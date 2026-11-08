import { requireUser } from '@/shared/lib/auth/guards';

import { HistoryDetailPage } from './HistoryDetailPage';

export async function HistoryDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  return <HistoryDetailPage user={{ name: user.name, email: user.email }} runId={id} />;
}
