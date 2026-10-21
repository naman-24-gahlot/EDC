'use client';

import { useState } from 'react';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch('/api/auth/session', { method: 'DELETE' });
    // A full page load, not a client navigation: it discards the browser's in-memory cache of
    // pages already visited, so the next person on this device can't see this account's pages.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full load: clears the in-browser page cache between accounts
    window.location.assign('/login');
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="min-h-10 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
