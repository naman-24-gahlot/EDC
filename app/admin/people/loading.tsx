import { SkeletonBlock, SkeletonCards, SkeletonChips, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading people…" className="space-y-4">
      <div className="flex flex-wrap gap-2"><SkeletonBlock className="h-10 flex-1 basis-60" /><SkeletonBlock className="h-10 w-28" /></div>
      <SkeletonChips count={6} />
      <SkeletonCards count={6} />
    </SkeletonScreen>
  );
}
