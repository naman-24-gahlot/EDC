'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
import { ID_TYPES } from '@/lib/idCheck';

type Direction = 'IN' | 'OUT';
const DIRECTION_KEY = 'edc-gate-direction';
const readDirection = (): Direction => { try { return localStorage.getItem(DIRECTION_KEY) === 'OUT' ? 'OUT' : 'IN'; } catch { return 'IN'; } };

// After an approved entry: record that a photo ID was seen (type + last 4 only).
function IdCheckForm({ entryId, onBusy }: { entryId: string; onBusy: (busy: boolean) => void }) {
  const [type, setType] = useState('');
  const [last4, setLast4] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/guard/id-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId, type, last4 }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Could not save');
      setState('saved');
      onBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setState('idle');
    }
  }
  if (state === 'saved') return <p className="mt-3 text-sm font-semibold">✓ Photo ID recorded</p>;
  return (
    <form onSubmit={save} onFocus={() => onBusy(true)} className="mx-auto mt-3 flex max-w-sm flex-wrap items-center justify-center gap-2 rounded bg-white/15 p-2 text-sm" aria-label="Record photo ID seen">
      <span className="w-full text-xs">No photo ID checked yet — check one and record it:</span>
      <select value={type} onChange={(e) => setType(e.target.value)} required aria-label="Kind of ID" className="min-h-10 rounded px-2 text-gray-900">
        <option value="">Kind of ID…</option>
        {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input value={last4} onChange={(e) => setLast4(e.target.value.slice(0, 4))} placeholder="last 4" aria-label="Last 4 characters (optional)" inputMode="text" autoComplete="off"
        className="min-h-10 w-20 rounded px-2 font-mono uppercase text-gray-900" />
      <button type="submit" disabled={state === 'saving' || !type} className="min-h-10 rounded bg-white px-3 font-semibold text-green-800 disabled:opacity-60">{state === 'saving' ? 'Saving…' : 'Record'}</button>
      {error && <span className="w-full text-xs">{error}</span>}
    </form>
  );
}

// What the guard should do next, for each reason the gate can give.
const GUIDANCE: Record<string, string> = {
  'Old QR (replaced)': 'This pass was replaced. Ask them to open their pass on their phone (a screenshot of an old QR no longer works), or type their access code.',
  'Invalid QR': 'Not an EDC pass, or the image is damaged. Ask them to open their pass again, or type their access code.',
  'Invalid access code': 'No one has this code. Check it for typos.',
  'Code superseded': 'Their profile type changed, so their code changed. The new code is on their pass.',
  'Registration not approved': 'Their registration is still waiting for approval.',
  'Account deactivated': 'Their account is switched off. Send them to the EDC office.',
  'Access revoked': 'An administrator ended their access period. Send them to the EDC office.',
  'No active access': 'They have no access period. They can request one from their account.',
  'Access expired': 'Their access period has ended. They can request a new one from their account.',
  'Access not yet active': 'Their access starts on a later date (shown on their pass).',
  'Outside permitted days': 'Their access does not cover today.',
  'Outside permitted hours': 'Their access does not cover this time of day.',
  'Campus holiday': 'The campus is closed today for their group. Send them to the EDC office if they must come in.',
};

type Verdict = {
  kind: 'verdict';
  approved: boolean;
  reason: string | null;
  exit?: boolean;
  entryId?: string | null;
  idCheck?: { type: string; last4: string | null; at: string | null } | null;
  person: { name: string; profileType: string | null; photoDataUrl: string | null; eventName?: string | null; vvip?: boolean } | null;
  notes?: string[];
};
// Anything that is not an explicit verdict from the server. Never green, never "approved".
type Unavailable = { kind: 'unavailable' };
type Result = Verdict | Unavailable;

const SCANNER_ELEMENT_ID = 'qr-reader';
const CODE_RE = /^[A-Za-z]{3}\d{5}$/;
const REQUEST_TIMEOUT_MS = 8000;
const RESULT_VISIBLE_MS = 5000;
// A reusable pass held in front of the camera would otherwise be verified (and logged)
// several times a second.
const RESCAN_COOLDOWN_MS = 3000;
const SAME_CODE_IGNORE_MS = 8000;

const PROFILE_LABEL: Record<string, string> = {
  employee: 'Employee', incubee: 'Incubee', event_guest: 'Event Guest',
  driver: 'Driver', relative: 'Relative', bodyguard: 'Bodyguard', visitor: 'Visitor',
};

function isVerdict(data: unknown): data is Omit<Verdict, 'kind'> {
  return !!data && typeof data === 'object' && typeof (data as { approved?: unknown }).approved === 'boolean';
}

export function GuardScanner() {
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualValue, setManualValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [direction, setDirectionState] = useState<Direction>('IN');
  const [holdResult, setHoldResult] = useState(false); // guard is filling in the ID form
  const directionRef = useRef<Direction>('IN');
  const manualRef = useRef<HTMLInputElement>(null);
  // The saved choice lives in this browser only, so it can only be read after hydration (the server always renders "Entry").
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage on mount
  useEffect(() => { const d = readDirection(); directionRef.current = d; setDirectionState(d); }, []);
  const setDirection = (d: Direction) => {
    directionRef.current = d;
    setDirectionState(d);
    try { localStorage.setItem(DIRECTION_KEY, d); } catch { /* private mode: just this session */ }
  };
  const scannerRef = useRef<Html5QrcodeType | null>(null);
  const lastScanRef = useRef<{ text: string; at: number } | null>(null);

  const verify = useCallback(async (payload: { token: string } | { code: string }) => {
    setVerifying(true);
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/guard/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, direction: directionRef.current }),
        signal: controller.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      setResult(response.ok && isVerdict(data) ? { kind: 'verdict', ...data } : { kind: 'unavailable' });
    } catch {
      setResult({ kind: 'unavailable' });
    } finally {
      clearTimeout(timer);
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (!result || holdResult) return;
    // Longer when the guard may want to record a photo ID.
    const needsId = result.kind === 'verdict' && result.approved && !result.exit && !result.idCheck;
    const timer = setTimeout(() => setResult(null), needsId ? 12_000 : RESULT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [result, holdResult]);

  useEffect(() => {
    if (mode !== 'camera') return;
    let cancelled = false;

    const resumeLater = (scanner: Html5QrcodeType) =>
      setTimeout(() => {
        if (cancelled) return;
        try {
          scanner.resume();
        } catch {
          // scanner may already be stopped (mode switched away) — ignore
        }
      }, RESCAN_COOLDOWN_MS);

    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 240 },
          (decodedText) => {
            scanner.pause(true);
            const now = Date.now();
            const last = lastScanRef.current;
            if (last && last.text === decodedText && now - last.at < SAME_CODE_IGNORE_MS) {
              resumeLater(scanner);
              return;
            }
            lastScanRef.current = { text: decodedText, at: now };
            const text = decodedText.trim();
            verify(CODE_RE.test(text) ? { code: text } : { token: text }).finally(() => resumeLater(scanner));
          },
          () => {
            // per-frame "no QR found" — expected on almost every frame, not an error
          }
        );
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Could not start camera');
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        // .stop() throws SYNCHRONOUSLY (not a rejected promise) if start()
        // never reached a running/paused state — e.g. camera permission was
        // denied. isScanning guards the common case; try/catch covers the rest.
        if (scanner.isScanning) {
          try {
            scanner
              .stop()
              .catch(() => {})
              .finally(() => scanner.clear());
          } catch {
            scanner.clear();
          }
        } else {
          scanner.clear();
        }
      }
    };
  }, [mode, verify]);

  function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = manualValue.trim();
    if (!value) return;
    verify(CODE_RE.test(value) ? { code: value.toUpperCase() } : { token: value });
    setManualValue('');
    manualRef.current?.focus(); // ready for the next scan from a USB / Bluetooth scanner
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Recording">
        {(['IN', 'OUT'] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDirection(d)} aria-pressed={direction === d} data-testid={`direction-${d}`}
            className={`min-h-12 rounded-lg text-base font-bold ${direction === d ? (d === 'IN' ? 'bg-green-700 text-white' : 'bg-sky-700 text-white') : 'bg-gray-100 text-gray-600'}`}>
            {d === 'IN' ? 'Entry →' : '← Exit'}
          </button>
        ))}
      </div>
      <div className="flex gap-1 border-b border-gray-200">
        {(['camera', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-2 text-sm font-medium ${
              mode === m ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {m === 'camera' ? 'Camera scan' : 'Type a code / USB scanner'}
          </button>
        ))}
      </div>

      {mode === 'camera' && (
        <div className="space-y-2">
          <div id={SCANNER_ELEMENT_ID} className="mx-auto w-full max-w-sm overflow-hidden rounded border border-gray-200" />
          {cameraError && (
            <p className="text-sm text-red-600">Camera error: {cameraError}. Use “Type a code / USB scanner” instead.</p>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            ref={manualRef}
            autoFocus
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="Access code (e.g. EDC25166) or pasted pass token"
            aria-label="Access code or pass token"
            autoCapitalize="characters"
            autoComplete="off"
            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={verifying || manualValue.trim().length === 0}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {verifying ? 'Checking…' : 'Verify'}
          </button>
        </form>
      )}

      {verifying && <p className="text-center text-sm text-gray-500">Checking…</p>}

      {result?.kind === 'unavailable' && (
        <div role="alert" data-testid="verdict" className="rounded-lg border-2 border-gray-400 bg-gray-100 p-6 text-center">
          <p className="text-2xl font-extrabold tracking-wide text-gray-800">VERIFICATION UNAVAILABLE</p>
          <p className="mt-1 text-sm text-gray-700">Do not admit on this result. Try again, or call your supervisor.</p>
        </div>
      )}

      {result?.kind === 'verdict' && (
        <div
          role="alert"
          data-testid="verdict"
          className={`rounded-lg p-6 text-center ${result.exit ? 'bg-sky-700 text-white' : result.approved ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
        >
          <p className="text-3xl font-extrabold tracking-wide">{result.exit ? 'EXIT RECORDED' : result.approved ? 'ENTRY APPROVED' : 'ENTRY DENIED'}</p>
          {!result.approved && direction === 'OUT' && <p className="mt-1 text-sm">Couldn&apos;t tell who this is, so no exit was recorded.</p>}
          {!result.approved && result.reason && <p className="mt-1 text-lg font-semibold">{result.reason}</p>}
          {!result.approved && result.reason && GUIDANCE[result.reason] && <p className="mx-auto mt-1 max-w-sm text-sm text-red-50" data-testid="guidance">{GUIDANCE[result.reason]}</p>}
          {result.person && (
            <div className="mt-4 flex items-center justify-center gap-3">
              {result.person.photoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- data: URL from the server response, not a static/remote asset
                <img src={result.person.photoDataUrl} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-white" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/25 text-2xl font-bold">
                  {result.person.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </div>
              )}
              <div className="text-left">
                <p className="text-xl font-bold">{result.person.name}</p>
                {result.person.profileType && (
                  <p className="text-sm opacity-90">{PROFILE_LABEL[result.person.profileType] ?? result.person.profileType}</p>
                )}
                {result.person.vvip && <p className="mt-1 inline-block rounded-full bg-purple-200 px-2.5 py-0.5 text-sm font-extrabold text-purple-950" data-testid="verdict-vvip">VVIP</p>}
                {result.person.eventName && (
                  <p className="mt-1 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold" data-testid="verdict-event">Event: {result.person.eventName}</p>
                )}
              </div>
            </div>
          )}
          {!!result.notes?.length && (
            <ul className="mx-auto mt-3 max-w-sm space-y-1 text-sm font-semibold" data-testid="verdict-notes">
              {result.notes.map((n) => <li key={n} className="rounded bg-white/20 px-2 py-1">{n}</li>)}
            </ul>
          )}
          {result.approved && !result.exit && (result.idCheck
            ? <p className="mt-3 text-sm" data-testid="id-checked">Photo ID checked: {result.idCheck.type}{result.idCheck.last4 ? ` ending ${result.idCheck.last4}` : ''}</p>
            : result.entryId ? <IdCheckForm key={result.entryId} entryId={result.entryId} onBusy={setHoldResult} /> : null)}
        </div>
      )}
    </div>
  );
}
