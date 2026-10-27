// CLIENT-SAFE (browser APIs only). Turns a chosen or captured photo into the JPEG data URL that
// lib/people/create.ts accepts (≤150KB, data:image/jpeg), and checks it's usable at the gate.
// One implementation for every photo field (components/PhotoInput.tsx).
//
// Works on every browser, including iPhone/iPad/Mac Safari:
//  - images are decoded with an <img> element first. That reads HEIC/HEIF (iPhone photos) wherever
//    the browser can show them (Safari), applies the photo's rotation (EXIF orientation), and works
//    on browsers without createImageBitmap; createImageBitmap is only the fallback.
//  - large photos are drawn at ≤1024 px straight away, so a 12-megapixel phone photo never makes a
//    full-size canvas (iOS refuses canvases over ~16 megapixels).
const MAX_PHOTO_DIMENSION = 256;
const WORK_DIMENSION = 1024;

export class PhotoError extends Error {}

const isHeic = (file: Blob) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test((file as File).name ?? '');

function drawScaled(source: CanvasImageSource, width: number, height: number, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('This browser can’t process photos — try another browser.');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function viaImg(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
    });
    if (!img.naturalWidth) throw new Error('decode');
    return drawScaled(img, img.naturalWidth, img.naturalHeight, WORK_DIMENSION);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Any photo file → a canvas (≤1024 px, rotated upright). Throws PhotoError with a plain message. */
export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  if (file.size > 30 * 1024 * 1024) throw new PhotoError('That file is too big — choose a photo under 30 MB.');
  try {
    return await viaImg(file);
  } catch {
    try {
      const bitmap = await createImageBitmap(file);
      return drawScaled(bitmap, bitmap.width, bitmap.height, WORK_DIMENSION);
    } catch {
      throw new PhotoError(isHeic(file)
        ? 'This browser can’t open HEIC photos (the iPhone format). Take the photo with “Use camera”, or choose a JPEG/PNG — on a Mac, open it in Preview and File → Export as JPEG.'
        : 'Could not read that image — choose a JPEG or PNG photo.');
    }
  }
}

/** File → the stored JPEG data URL (no quality check). */
export async function downscalePhoto(file: File): Promise<string> {
  return canvasToJpeg(await loadPhoto(file));
}

/**
 * Plain checks that a photo can identify someone at the gate: big enough, not too dark or washed
 * out, not blurry. Returns the problem, or null. Quality only — this is not identity checking.
 */
export async function photoProblem(source: Blob | HTMLCanvasElement): Promise<string | null> {
  const img = source instanceof HTMLCanvasElement ? source : await loadPhoto(source);
  if (Math.min(img.width, img.height) < 160) return 'That photo is too small — use one at least 160 pixels across.';
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const gray = new Float32Array(size * size);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) { gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; sum += gray[i]; }
  const mean = sum / gray.length;
  if (mean < 45) return 'That photo is too dark — face a light or window.';
  if (mean > 225) return 'That photo is washed out — move away from bright light behind or in front of you.';
  // Sharpness: variance of the Laplacian (edges); low = blurry.
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
    s += lap; s2 += lap * lap; n++;
  }
  const variance = s2 / n - (s / n) ** 2;
  if (variance < 25) return 'That photo looks blurry — hold still, or use a sharper one.';
  return null;
}

/** A canvas → the stored JPEG data URL (≤256 px, quality 0.8 — well under the 150 KB limit). */
export function canvasToJpeg(source: HTMLCanvasElement): string {
  const canvas = drawScaled(source, source.width, source.height, MAX_PHOTO_DIMENSION);
  const url = canvas.toDataURL('image/jpeg', 0.8);
  // A browser without JPEG encoding would silently hand back PNG, which the server refuses.
  if (!url.startsWith('data:image/jpeg')) throw new PhotoError('This browser can’t save the photo — try another browser.');
  return url;
}
