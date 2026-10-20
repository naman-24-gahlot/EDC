import { redirect } from 'next/navigation';

// Retired: the member area lives at /me. Kept only so old links and bookmarks still land.
export default function EmployeeRedirect() {
  redirect('/me');
}
