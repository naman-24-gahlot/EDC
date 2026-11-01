import { SkeletonBlock, SkeletonLines, SkeletonRows, SkeletonScreen } from '@/components/Skeleton';

export default function Loading() {
  return (
    <SkeletonScreen label="Loading the event…" className="space-y-4">
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="h-7 w-64 max-w-full" />
      <SkeletonLines lines={2} className="max-w-md" />
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"><SkeletonBlock className="h-3 w-28" /><SkeletonBlock className="h-10 w-full" /><div className="flex gap-2"><SkeletonBlock className="h-9 w-24" /><SkeletonBlock className="h-9 w-24" /></div></div>
      <SkeletonRows rows={4} />
    </SkeletonScreen>
  );
}
