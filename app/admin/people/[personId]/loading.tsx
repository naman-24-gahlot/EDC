import { SkeletonBlock, SkeletonLines, SkeletonScreen, SkeletonSection } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading this person…" className="space-y-4">
      <SkeletonBlock className="h-3 w-24" />
      <div className="flex items-start gap-4">
        <SkeletonBlock className="h-24 w-24 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-3 pt-1"><SkeletonBlock className="h-6 w-56 max-w-full" /><SkeletonLines lines={2} className="max-w-sm" /></div>
      </div>
      <SkeletonSection rows={4} />
      <SkeletonSection rows={3} />
    </SkeletonScreen>
  );
}
