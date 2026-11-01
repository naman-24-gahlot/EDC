// The two IIM Jammu logos (public/brand): the wide lockup for page headers, the upright mark
// where space is tight (phones) or for a centred brand moment. Static images, sized by height.
/* eslint-disable @next/next/no-img-element -- small static brand images; no optimisation needed */
export function IimLockup({ className = 'h-10' }: { className?: string }) {
  return <img src="/brand/iim-jammu-lockup.png" alt="Indian Institute of Management Jammu" width={977} height={248} className={`w-auto ${className}`} />;
}

export function IimMark({ className = 'h-10' }: { className?: string }) {
  return <img src="/brand/iim-jammu-logo.png" alt="IIM Jammu" width={363} height={452} className={`w-auto ${className}`} />;
}
