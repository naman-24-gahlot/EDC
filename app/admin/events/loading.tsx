import { SkeletonBlock, SkeletonRows, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading events…" className="space-y-4">
      <div className="flex items-center justify-between gap-3"><SkeletonBlock className="h-7 w-40" /><SkeletonBlock className="h-10 w-32" /></div>
      <SkeletonRows rows={4} />
    </SkeletonScreen>
  );
}
