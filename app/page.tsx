import { redirect } from 'next/navigation';
import { getPasswordResetSession, getSessionUser } from '@/lib/session';
import { ROLE_HOME_PATH } from '@/lib/roles';

export default async function RootPage() {
  if (await getPasswordResetSession()) redirect('/set-password');
  const user = await getSessionUser();
  redirect(user ? ROLE_HOME_PATH[user.systemRole] : '/login');
}
