// CLIENT-SAFE (browser APIs only). Downscales a chosen photo to the JPEG data URL that
// lib/people/create.ts accepts (≤150KB, data:image/jpeg) — one implementation so the
// registration form and "create person under me" can't drift apart.
const MAX_PHOTO_DIMENSION = 256;

export async function downscalePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * Plain checks that a photo can identify someone at the gate: big enough, not too dark or washed
 * out, not blurry. Returns the problem, or null. Quality only — this is not identity checking.
 */
export async function photoProblem(source: Blob | HTMLCanvasElement): Promise<string | null> {
  const bitmap = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);
  if (Math.min(bitmap.width, bitmap.height) < 160) return 'That photo is too small — use one at least 160 pixels across.';
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, size, size);
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

/** Same downscale as downscalePhoto, from a canvas (camera capture). */
export function canvasToJpeg(source: HTMLCanvasElement): string {
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}
