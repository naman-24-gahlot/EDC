'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';

// The testing-mode switch (lib/testMode.ts), on every Master page. While it's on, a bar says so,
// so it isn't left on by accident before presenting or going live.
export function TestModeBar({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    const next = !on;
    if (!window.confirm(next
      ? 'Turn testing mode ON?\n\n• Test email addresses (…@….test) work — their emails go to the test outbox\n• Registration: name, mobile and purpose may be left blank\n• No “I’m human” check on the public forms'
      : 'Turn testing mode OFF?\n\n• Test email addresses are refused for new sign-ups\n• Registration needs every field again\n• The “I’m human” check is asked for (once its keys are set)')) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/settings', { testMode: next }, 'PATCH');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change testing mode.');
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <button type="button" onClick={flip} disabled={busy} data-testid="test-mode-switch"
      className={`inline-flex min-h-10 shrink-0 items-center rounded border px-3 text-xs font-semibold disabled:opacity-50 md:min-h-8 ${on ? 'border-amber-700 bg-white text-amber-900' : 'border-gray-300 text-gray-600'}`}>
      {busy ? 'Saving…' : on ? 'Turn testing mode off' : 'Turn testing mode on'}
    </button>
  );
  return (
    <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 text-xs ${on ? 'border border-amber-300 bg-amber-50 text-amber-950' : 'text-gray-500'}`} data-testid="test-mode-bar" data-on={on}>
      <span>
        {on
          ? <><b>Testing mode is ON</b> — test email addresses work, registration fields are optional, no “I’m human” check. Turn it off before presenting or going live.</>
          : <>Testing mode is off.</>}
        {error && <span className="ml-2 text-red-700" role="alert">{error}</span>}
      </span>
      {button}
    </div>
  );
}
