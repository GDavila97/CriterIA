import { publicEnv } from '@/shared/config';
import { optionalUser } from '@/shared/lib/auth/guards';

import { PrivacyPage } from './PrivacyPage';

export async function PrivacyRoute() {
  const user = await optionalUser();
  return (
    <PrivacyPage
      user={user && { name: user.name, email: user.email, providers: user.providers }}
      contactUrl={publicEnv.NEXT_PUBLIC_CONTACT_URL}
    />
  );
}
