import { redirect } from 'next/navigation';

import { requireUser } from '@/shared/lib/auth/guards';

import { AccountSettingsPage, HistorySettingsPage, ModelsSettingsPage } from './SettingsPages';

export function SettingsIndexRoute(): never {
  redirect('/ajustes/modelos');
}

export async function ModelsSettingsRoute() {
  const user = await requireUser();
  return <ModelsSettingsPage user={{ name: user.name, email: user.email }} />;
}

export async function AccountSettingsRoute() {
  const user = await requireUser();
  return (
    <AccountSettingsPage user={{ name: user.name, email: user.email, providers: user.providers }} />
  );
}

export async function HistorySettingsRoute() {
  const user = await requireUser();
  return <HistorySettingsPage user={{ name: user.name, email: user.email }} />;
}
