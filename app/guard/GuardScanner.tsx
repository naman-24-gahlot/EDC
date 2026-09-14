'use client';

import { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';

type VerifyResult =
  | { approved: true; employeeName: string }
  | { approved: false; reason: string };

const SCANNER_ELEMENT_ID = 'qr-reader';

export function GuardScanner() {
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualToken, setManualToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeType | null>(null);

  async function verify(token: string) {
    setVerifying(true);
    try {
      const response = await fetch('/api/guard/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({ approved: false, reason: 'Network error — try again' });
    } finally {
      setVerifying(false);
    }
  }

  // Auto-dismiss the result banner so the guard can move to the next person
  // without an extra tap.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 4000);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (mode !== 'camera') return;
    let cancelled = false;

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
            verify(decodedText).finally(() => {
              if (!cancelled) {
                try {
                  scanner.resume();
                } catch {
                  // scanner may already be stopped (mode switched away) — ignore
                }
              }
            });
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
  }, [mode]);

  function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    const token = manualToken.trim();
    if (token) {
      verify(token);
      setManualToken('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200">
        {(['camera', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-2 text-sm font-medium ${
              mode === m
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {m === 'camera' ? 'Camera scan' : 'Manual entry'}
          </button>
        ))}
      </div>

      {mode === 'camera' && (
        <div className="space-y-2">
          <div
            id={SCANNER_ELEMENT_ID}
            className="mx-auto w-full max-w-sm overflow-hidden rounded border border-gray-200"
          />
          {cameraError && (
            <p className="text-sm text-red-600">
              Camera error: {cameraError}. Use manual entry instead.
            </p>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="Paste or type the pass token"
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          <button
            type="submit"
            disabled={verifying || manualToken.trim().length === 0}
            className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {verifying ? 'Checking…' : 'Verify'}
          </button>
        </form>
      )}

      {verifying && mode === 'camera' && (
        <p className="text-center text-sm text-gray-500">Checking…</p>
      )}

      {result && (
        <div
          className={`rounded p-4 text-center ${result.approved ? 'bg-green-100' : 'bg-red-100'}`}
        >
          <p
            className={`text-lg font-bold ${result.approved ? 'text-green-800' : 'text-red-800'}`}
          >
            {result.approved ? 'ENTRY APPROVED' : 'NOT APPROVED'}
          </p>
          <p className={`text-sm ${result.approved ? 'text-green-800' : 'text-red-800'}`}>
            {result.approved ? result.employeeName : result.reason}
          </p>
        </div>
      )}
    </div>
  );
}
