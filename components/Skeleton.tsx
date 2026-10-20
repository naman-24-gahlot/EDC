// Shown instantly on navigation (via loading.tsx) while the server loads the page, so a tap
// never looks like it did nothing. Purely presentational.
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200/80 motion-reduce:animate-none ${className}`} />;
}

export function PageSkeleton({ rows = 3, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <SkeletonBlock className="h-8 w-48" />
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBlock key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}
