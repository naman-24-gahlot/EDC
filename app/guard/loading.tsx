import { SkeletonBlock, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <SkeletonScreen label="Loading the gate…" className="space-y-6">
        <div className="flex items-center justify-between"><SkeletonBlock className="h-5 w-36" /><SkeletonBlock className="h-9 w-24" /></div>
        <div className="space-y-3"><SkeletonBlock className="h-10 w-full rounded-full" /><SkeletonBlock className="aspect-square w-full max-w-sm" /><SkeletonBlock className="h-11 w-full" /></div>
        <SkeletonBlock className="h-14 w-full" />
      </SkeletonScreen>
    </main>
  );
}
