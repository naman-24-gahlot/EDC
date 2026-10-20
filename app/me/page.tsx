import { redirect } from 'next/navigation';

// The full member home is built in P9; until then /me goes straight to the pass.
export default function MePage() {
  redirect('/me/pass');
}
