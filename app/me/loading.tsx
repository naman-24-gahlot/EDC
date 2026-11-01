import { SkeletonBlock, SkeletonScreen, SkeletonSection } from '@/components/Skeleton';

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <SkeletonScreen label="Loading your account…" className="space-y-6">
        <div className="flex items-center justify-between"><SkeletonBlock className="h-5 w-36" /><SkeletonBlock className="h-9 w-24" /></div>
        <div className="flex items-center gap-4"><SkeletonBlock className="h-16 w-16 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><SkeletonBlock className="h-5 w-48" /><SkeletonBlock className="h-3 w-32" /></div></div>
        <SkeletonBlock className="h-24 w-full rounded-xl" />
        <SkeletonSection rows={4} />
        <SkeletonSection rows={3} />
      </SkeletonScreen>
    </main>
  );
}
