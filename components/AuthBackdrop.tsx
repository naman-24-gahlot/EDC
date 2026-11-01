// The sign-in pages' background: EDC's brand colours drifting slowly behind the card (styles:
// .aurora-blob in app/globals.css — transform only, still for reduced motion, hidden in print).
// Purely decorative, behind everything, ignores clicks.
export function AuthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#F4F8FB]">
      <div className="aurora-blob -left-[10vw] -top-[12vh] h-[55vh] w-[55vh] bg-[#0D5B7A]/30" />
      <div className="aurora-blob -right-[12vw] top-[20vh] h-[50vh] w-[50vh] bg-[#004180]/25" />
      <div className="aurora-blob bottom-[-18vh] left-[25vw] h-[45vh] w-[45vh] bg-[#DB3B51]/12" />
      {/* A fine dot grid gives the glass something to blur. */}
      <div className="absolute inset-0 bg-[radial-gradient(rgb(13_91_122/0.10)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
    </div>
  );
}

/** The EDC mark for the top of sign-in cards. */
export function EdcMark() {
  return (
    <span aria-hidden className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#004180] to-[#0D5B7A] text-[13px] font-bold tracking-wider text-white shadow-[0_6px_16px_-6px_rgb(0_65_128/0.6)] ring-1 ring-white/20">
      EDC
    </span>
  );
}

const cardShadow = 'rounded-2xl border border-white/70 shadow-[0_24px_48px_-24px_rgb(10_40_60/0.35),0_2px_6px_rgb(10_40_60/0.06)]';
/** Frosted glass, for small cards. */
export const glassCard = `${cardShadow} bg-white/80 backdrop-blur-xl`;
/** Nearly opaque, no blur — for long forms, so scrolling stays smooth on slow phones. */
export const plainCard = `${cardShadow} bg-white/95`;
/** The card the sign-in forms sit on. */
export const authCard = `w-full max-w-sm p-6 ${glassCard}`;
/** The main button on sign-in cards. */
export const primaryButton = 'w-full rounded-lg bg-gradient-to-b from-[#0D5B7A] to-[#004180] px-3 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-10px_rgb(0_65_128/0.8)] hover:brightness-110 disabled:opacity-50';
