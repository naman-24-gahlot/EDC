import { SkeletonBlock } from '@/components/Skeleton';

export default function Loading() {
  return (
    <main role="status" aria-live="polite" className="mx-auto w-full max-w-md px-4 py-6">
      <span className="sr-only">Loading your entry pass…</span>
      <div className="overflow-hidden rounded-[22px] border border-[#D5DDE4] bg-[#F7F9FB]">
        <div className="h-16 bg-gradient-to-r from-[#004180] to-[#0D5B7A]" />
        <div className="flex flex-col items-center gap-4 px-5 py-6">
          <SkeletonBlock className="h-16 w-16 rounded-full" />
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="aspect-square w-[300px] max-w-full" />
          <SkeletonBlock className="h-8 w-44" />
        </div>
      </div>
    </main>
  );
}
