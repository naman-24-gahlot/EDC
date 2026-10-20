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
