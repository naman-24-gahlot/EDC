import type { Shape } from '@/lib/passCard';
import { PT } from '@/lib/passCard';

const FONT: Record<string, { family: string; weight: number }> = {
  regular: { family: 'Helvetica, Arial, sans-serif', weight: 400 },
  bold: { family: 'Helvetica, Arial, sans-serif', weight: 700 },
  mono: { family: '"Courier New", Courier, monospace', weight: 700 },
};

/** The QR as one SVG path — one square per dark module. */
function qrPath(modules: number, cells: number[], size: number) {
  const u = size / modules;
  return cells.map((i) => `M${(i % modules) * u} ${Math.floor(i / modules) * u}h${u}v${u}h${-u}z`).join('');
}

// Draws lib/passCard.ts's layout. Sized in real millimetres, so it prints at exactly the card size.
export function PassCardSvg({ w, h, shapes, className }: { w: number; h: number; shapes: Shape[]; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={`${w}mm`} height={`${h}mm`} className={className} role="img" aria-label="Entry pass">
      {shapes.map((s, i) => {
        switch (s.kind) {
          case 'rect': return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} fill={s.fill} stroke={s.stroke} strokeWidth={s.stroke ? s.strokeWidth ?? 0.2 : undefined} />;
          case 'line': return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash ? `${s.width * 4} ${s.width * 3}` : undefined} />;
          case 'photo': return (
            <g key={i}>
              <clipPath id={`ph${i}`}><rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} /></clipPath>
              <image href={s.src} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#ph${i})`} />
            </g>
          );
          case 'qr': return <path key={i} transform={`translate(${s.x} ${s.y})`} d={qrPath(s.modules, s.cells, s.size)} fill="#000" />;
          case 'text': {
            // Letter spacing is added after each character; centring/right-aligning accounts for it the
            // same way the PDF does (lib/passCard.ts textWidth), so we position by the left edge.
            return (
              <text key={i} x={s.x} y={s.y} fontSize={s.size * PT} fontFamily={FONT[s.font].family} fontWeight={FONT[s.font].weight} fill={s.color}
                letterSpacing={s.spacing || undefined} textAnchor={s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start'}>{s.text}</text>
            );
          }
        }
      })}
    </svg>
  );
}
