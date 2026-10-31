'use client';

import { useEffect, useState } from 'react';

// Is testing mode on (lib/testMode.ts)? Asked once per page load, shared by every form on it.
// null until known. `enabled: false` skips the request (the answer then stays null).
let answer: Promise<boolean> | null = null;
export function useTestMode(enabled = true): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    answer ??= fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json()).then((d) => d?.testMode === true).catch(() => false);
    let live = true;
    answer.then((v) => { if (live) setOn(v); });
    return () => { live = false; };
  }, [enabled]);
  return on;
}
