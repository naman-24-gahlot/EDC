import { redirect } from 'next/navigation';
import { getPasswordResetSession, getSessionUser } from '@/lib/session';
import { loadPerson } from '@/lib/hierarchy/authorize';
import { ROLE_HOME_PATH } from '@/lib/roles';
import { SetPasswordForm } from './SetPasswordForm';

export const dynamic = 'force-dynamic';

// The one page a one-time-password session can open (lib/session.ts keeps it out of the rest).
export default async function SetPasswordPage() {
  const user = await getPasswordResetSession();
  if (!user) {
    const normal = await getSessionUser();
    redirect(normal ? ROLE_HOME_PATH[normal.systemRole] : '/login');
  }
  const person = await loadPerson(user.personId);
  return <SetPasswordForm username={person?.username ?? ''} name={person ? person.firstName : ''} fullName={person ? `${person.firstName} ${person.lastName}` : ''} email={user.email ?? ''} />;
}
