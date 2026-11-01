import { AsciiLogo } from './brand/AsciiLogo';
import { DecodeText } from './brand/DecodeText';

// The sign-in pages' background: IIM Jammu's colours drifting slowly, and light flowing along
// curves like the logo's wing stripes (styles: .aurora-blob, .flow-path in app/globals.css —
// still for reduced motion, hidden in print). Purely decorative, behind everything, ignores clicks.
const PATHS = Array.from({ length: 11 }, (_, i) => ({
  d: `M-120 ${560 + i * 16} C 260 ${470 + i * 12}, 560 ${250 + i * 20}, 1320 ${70 + i * 24}`,
  width: 1 + (i % 3) * 0.5,
  opacity: 0.1 + (i % 4) * 0.05,
  duration: 18 + (i % 5) * 4,
  delay: -i * 2.3,
}));

export function AuthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#F5F8FC]">
      <div className="aurora-blob -left-[10vw] -top-[12vh] h-[55vh] w-[55vh] bg-iim-blue/25" />
      <div className="aurora-blob -right-[12vw] top-[20vh] h-[50vh] w-[50vh] bg-iim-navy/20" />
      <div className="aurora-blob bottom-[-18vh] left-[25vw] h-[45vh] w-[45vh] bg-iim-red/10" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" fill="none">
        {PATHS.map((p, i) => (
          <g key={i}>
            <path d={p.d} stroke="var(--color-iim-blue)" strokeOpacity={p.opacity * 0.5} strokeWidth={p.width} />
            <path d={p.d} className="flow-path" stroke={i % 4 === 3 ? 'var(--color-iim-red)' : 'var(--color-iim-blue)'} strokeOpacity={p.opacity * 2.2}
              strokeWidth={p.width + 0.5} strokeLinecap="round" style={{ animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }} />
          </g>
        ))}
      </svg>
      {/* A fine dot grid gives the glass something to blur. */}
      <div className="absolute inset-0 bg-[radial-gradient(rgb(39_58_144/0.09)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
    </div>
  );
}

/** The top of the sign-in and registration cards: the ASCII logo, and a title that decodes itself. */
export function AuthBrand({ title, subtitle, logoWidth = 116 }: { title: string; subtitle?: React.ReactNode; logoWidth?: number }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <AsciiLogo width={logoWidth} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-iim-navy"><DecodeText text={title} delay={500} /></h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

const cardShadow = 'rounded-2xl border border-iim-navy/10 shadow-[0_24px_48px_-24px_rgb(39_58_144/0.35),0_2px_6px_rgb(10_40_60/0.06)]';
/** Frosted glass, for small cards. */
export const glassCard = `${cardShadow} bg-white/80 backdrop-blur-xl`;
/** Nearly opaque, no blur — for long forms, so scrolling stays smooth on slow phones. */
export const plainCard = `${cardShadow} bg-white/95`;
/** The card the sign-in forms sit on. */
export const authCard = `w-full max-w-sm p-6 ${glassCard}`;
/** The main button on sign-in cards. */
export const primaryButton = 'btn-sheen w-full rounded-lg bg-gradient-to-b from-iim-blue to-iim-navy px-3 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-10px_rgb(39_58_144/0.8)] hover:brightness-110 disabled:opacity-50';
