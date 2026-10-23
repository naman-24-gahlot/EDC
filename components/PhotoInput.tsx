'use client';

import { useEffect, useRef, useState } from 'react';
import { canvasToJpeg, downscalePhoto, photoProblem } from '@/lib/photo';

// Profile photo: take one with the camera (preferred — a live photo is harder to fake) or upload
// one. Either way it's checked for size, light and sharpness, then shrunk to ≤150 KB in the
// browser (the server re-checks the size). Nothing is sent until the form is submitted.
export function PhotoInput({ value, onChange }: { value: string | null; onChange: (dataUrl: string | null) => void }) {
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCamera(false); };
  useEffect(() => stop, []);

  async function openCamera() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      setCamera(true);
      requestAnimationFrame(() => { if (video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play(); } });
    } catch {
      setError('The camera isn’t available here — upload a photo instead.');
    }
  }

  async function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight); // square, centred: a head-and-shoulders crop
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    canvas.getContext('2d')!.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    const problem = await photoProblem(canvas);
    if (problem) return setError(problem);
    setError(null);
    onChange(canvasToJpeg(canvas));
    stop();
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const problem = await photoProblem(file);
      if (problem) return setError(problem);
      onChange(await downscalePhoto(file));
    } catch {
      setError('Could not read that image — try a JPEG or PNG.');
    }
  }

  const btn = 'inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-sm';
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Profile photo <span className="font-normal text-gray-500">(optional — guards see it at the gate)</span></span>
      {camera ? (
        <div className="space-y-2">
          <video ref={video} playsInline muted className="aspect-square w-48 rounded-lg bg-black object-cover" aria-label="Camera preview" />
          <div className="flex gap-2">
            <button type="button" onClick={snap} className={`${btn} border-gray-900 bg-gray-900 text-white`}>Take photo</button>
            <button type="button" onClick={stop} className={btn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {value && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL preview
            <img src={value} alt="Your photo" className="h-16 w-16 rounded-full object-cover" />
          )}
          <button type="button" onClick={openCamera} className={btn}>{value ? 'Retake with camera' : 'Use camera'}</button>
          <label className={`${btn} cursor-pointer`}>
            {value ? 'Choose another' : 'Upload a photo'}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {value && <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-500 underline">Remove</button>}
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
