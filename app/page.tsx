import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { ROLE_HOME_PATH } from '@/lib/roles';

export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? ROLE_HOME_PATH[user.role] : '/login');
}
