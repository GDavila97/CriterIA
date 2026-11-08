import { optionalUser } from '@/shared/lib/auth/guards';

import { EvaluationPage } from './EvaluationPage';

export async function EvaluationRoute() {
  const user = await optionalUser();
  return <EvaluationPage user={user && { name: user.name, email: user.email }} />;
}
