import { ImageResponse } from 'next/og';

const SIZES = new Set([180, 192, 512]);

// App icons drawn at request time by Next's built-in image renderer (no image files to keep).
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const n = Number((await params).size);
  const size = SIZES.has(n) ? n : 192;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0D5B7A', color: '#fff', fontSize: size * 0.3, fontWeight: 700, letterSpacing: -size * 0.01 }}>
        EDC
      </div>
    ),
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=86400, immutable' } },
  );
}
