import { LoginForm } from './LoginForm';

// ?expired=1 is set by requirePageRole when a session existed but has ended; ?deleted=1 after
// someone deletes their own account (My account → Delete my account).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; deleted?: string }> }) {
  const { expired, deleted } = await searchParams;
  const notice = deleted ? 'Your account and its data have been deleted. You can register again any time.'
    : expired ? 'Your session ended (it timed out, or you were signed out elsewhere). Please sign in again.' : null;
  return <LoginForm notice={notice} />;
}
