'use client';

import { useEffect, useRef, useState } from 'react';
import { PhotoError, canvasToJpeg, loadPhoto, photoProblem } from '@/lib/photo';

type CameraState = 'off' | 'starting' | 'on';

// Profile photo, used by every photo field (registration, "create person under me", My account).
// Two ways in, so it works on every device:
//  - "Use camera": a live preview in the page (getUserMedia) where the browser allows it;
//  - "Take or choose a photo": the device's own picker — on phones it offers the camera too, and it
//    works inside in-app browsers (WhatsApp, Instagram, Gmail) where the live camera doesn't.
// Either way the photo is checked for size, light and sharpness and shrunk to ≤150 KB in the
// browser (the server re-checks). Nothing is sent until the form is submitted.
export function PhotoInput({ value, onChange, label = 'Profile photo', hint = 'optional — guards see it at the gate' }: {
  value: string | null; onChange: (dataUrl: string | null) => void; label?: string; hint?: string;
}) {
  const [camera, setCamera] = useState<CameraState>('off');
  const [canLive, setCanLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  // Decided after mounting (not during render), so server and browser HTML match.
  useEffect(() => {
    setCanLive(typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia); // eslint-disable-line react-hooks/set-state-in-effect -- feature detection needs the browser
  }, []);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCamera('off'); };
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  // Attach the stream once the <video> is actually on the page (Safari shows nothing otherwise).
  useEffect(() => {
    const v = video.current;
    if (camera === 'off' || !v || !stream.current || v.srcObject === stream.current) return;
    v.srcObject = stream.current;
    v.onloadedmetadata = () => { void v.play().catch(() => {}); setCamera('on'); };
  }, [camera]);

  async function openCamera() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } }, audio: false });
      setCamera('starting');
    } catch (err) {
      const name = (err as { name?: string })?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Camera permission was blocked. Allow the camera for this site (iPhone: Settings → Safari → Camera; Mac: Safari → Settings → Websites → Camera), or use “Take or choose a photo”.'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No camera was found — use “Take or choose a photo”.'
          : 'The camera couldn’t start here — use “Take or choose a photo”.');
    }
  }

  async function accept(canvas: HTMLCanvasElement) {
    const problem = await photoProblem(canvas);
    if (problem) { setError(problem); return false; }
    onChange(canvasToJpeg(canvas));
    setError(null);
    return true;
  }

  async function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return setError('The camera is still starting — try again in a moment.');
    const side = Math.min(v.videoWidth, v.videoHeight); // square, centred: a head-and-shoulders crop
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    canvas.getContext('2d')!.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    if (await accept(canvas).catch((e) => { setError(e instanceof PhotoError ? e.message : 'Could not use that photo.'); return false; })) stop();
  }

  async function upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = ''; // so choosing the same file again still triggers a change
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await accept(await loadPhoto(file));
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : 'Could not read that image — choose a JPEG or PNG photo.');
    } finally {
      setBusy(false);
    }
  }

  const btn = 'inline-flex min-h-11 items-center justify-center rounded border border-gray-300 bg-white px-3 text-sm font-medium';
  return (
    <div className="space-y-2" data-testid="photo-input">
      <span className="block text-sm font-medium">{label} {hint && <span className="font-normal text-gray-500">({hint})</span>}</span>
      {camera !== 'off' ? (
        <div className="space-y-2">
          <video ref={video} autoPlay playsInline muted aria-label="Camera preview"
            className="aspect-square w-56 max-w-full -scale-x-100 rounded-lg bg-black object-cover" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={snap} disabled={camera !== 'on'} className={`${btn} border-gray-900 bg-gray-900 text-white disabled:opacity-50`}>
              {camera === 'on' ? 'Take photo' : 'Starting camera…'}
            </button>
            <button type="button" onClick={stop} className={btn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {value && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL preview
            <img src={value} alt="Your photo" className="h-16 w-16 rounded-full object-cover" />
          )}
          {canLive && <button type="button" onClick={openCamera} className={btn}>{value ? 'Retake with camera' : 'Use camera'}</button>}
          <label className={`${btn} cursor-pointer focus-within:ring-2 focus-within:ring-gray-900`}>
            {busy ? 'Reading photo…' : value ? 'Choose another' : 'Take or choose a photo'}
            {/* Not display:none — iOS won't open the picker for a hidden input. HEIC listed so Macs offer iPhone photos. */}
            <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(e) => upload(e.currentTarget)} />
          </label>
          {value && <button type="button" onClick={() => onChange(null)} className="min-h-11 px-1 text-xs text-gray-500 underline">Remove</button>}
        </div>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
