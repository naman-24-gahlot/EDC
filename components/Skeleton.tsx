// Grey placeholders in the shape of what's loading, shown instantly on navigation (via
// loading.tsx) and while on-demand parts load, so a tap never looks like it did nothing.
// Purely presentational. The shimmer and the short fade-in delay (a fast load never flashes a
// skeleton) are `.skeleton` / `.skeleton-in` in app/globals.css; both stop for reduced motion.
import type { ReactNode } from 'react';

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${/\brounded-/.test(className) ? '' : 'rounded-lg '}${className}`} />;
}

/** The wrapper every skeleton screen uses: announced once to screen readers, fades in after a beat. */
export function SkeletonScreen({ label = 'Loading…', className = '', children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy className={`skeleton-in ${className}`}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

const WIDTHS = ['w-11/12', 'w-4/5', 'w-2/3', 'w-3/4', 'w-1/2'];
/** Lines of text of varying length. */
export function SkeletonLines({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => <SkeletonBlock key={i} className={`h-3 ${WIDTHS[i % WIDTHS.length]}`} />)}
    </div>
  );
}

/** A row of filter chips. */
export function SkeletonChips({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, i) => <SkeletonBlock key={i} className={`h-9 rounded-full ${i % 2 ? 'w-24' : 'w-20'}`} />)}
    </div>
  );
}

/** Person cards (components/PersonCard.tsx). */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex items-start gap-3">
            <SkeletonBlock className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2 pt-1"><SkeletonBlock className="h-3.5 w-3/4" /><SkeletonBlock className="h-3 w-1/2" /></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
            {Array.from({ length: 6 }, (_, j) => <SkeletonBlock key={j} className={`h-2.5 ${j % 2 ? 'ml-auto w-2/3' : 'w-1/2'}`} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rows of a list or table. */
export function SkeletonRows({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <SkeletonBlock className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><SkeletonBlock className={`h-3 ${WIDTHS[i % WIDTHS.length]}`} /><SkeletonBlock className="h-2.5 w-1/3" /></div>
          <SkeletonBlock className="hidden h-7 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

/** A titled section with label/value lines (the account page's sections). */
export function SkeletonSection({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 rounded-xl border border-[#D5DDE4] bg-[#F7F9FB] p-4 ${className}`}>
      <SkeletonBlock className="h-3 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex justify-between gap-4"><SkeletonBlock className="h-3 w-24" /><SkeletonBlock className={`h-3 ${i % 2 ? 'w-28' : 'w-40'}`} /></div>
      ))}
    </div>
  );
}

/** Generic page: a title, filters and a list. */
export function PageSkeleton({ rows = 5, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <SkeletonScreen label={label} className="space-y-4">
      <SkeletonBlock className="h-7 w-48" />
      <SkeletonChips />
      <SkeletonRows rows={rows} />
    </SkeletonScreen>
  );
}
