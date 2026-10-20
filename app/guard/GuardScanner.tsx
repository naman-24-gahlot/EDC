'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';

type Verdict = {
  kind: 'verdict';
  approved: boolean;
  reason: string | null;
  person: { name: string; profileType: string | null; photoDataUrl: string | null } | null;
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
  driver: 'Driver', relative: 'Relative', bodyguard: 'Bodyguard',
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
        body: JSON.stringify(payload),
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
    if (!result) return;
    const timer = setTimeout(() => setResult(null), RESULT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [result]);

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
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200">
        {(['camera', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-2 text-sm font-medium ${
              mode === m ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {m === 'camera' ? 'Camera scan' : 'Type a code'}
          </button>
        ))}
      </div>

      {mode === 'camera' && (
        <div className="space-y-2">
          <div id={SCANNER_ELEMENT_ID} className="mx-auto w-full max-w-sm overflow-hidden rounded border border-gray-200" />
          {cameraError && (
            <p className="text-sm text-red-600">Camera error: {cameraError}. Use “Type a code” instead.</p>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
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
          className={`rounded-lg p-6 text-center ${result.approved ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
        >
          <p className="text-3xl font-extrabold tracking-wide">{result.approved ? 'ENTRY APPROVED' : 'ENTRY DENIED'}</p>
          {!result.approved && result.reason && <p className="mt-1 text-lg font-semibold">{result.reason}</p>}
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
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
