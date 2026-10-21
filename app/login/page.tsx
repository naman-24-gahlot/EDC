import { LoginForm } from './LoginForm';

// ?expired=1 is set by requirePageRole when a session existed but has ended.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return <LoginForm notice={expired ? 'Your session ended (it timed out, or you were signed out elsewhere). Please sign in again.' : null} />;
}
