import { SkeletonBlock, SkeletonScreen } from '@/components/Skeleton';

// A tree: employees, each with a few people under them.
export default function Loading() {
  return (
    <SkeletonScreen label="Loading the hierarchy…" className="space-y-4">
      <SkeletonBlock className="h-7 w-40" />
      {[3, 2, 1].map((under, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-3"><SkeletonBlock className="h-9 w-9 shrink-0 rounded-full" /><SkeletonBlock className="h-3.5 w-44" /></div>
          <div className="ml-4 space-y-2 border-l-2 border-gray-100 pl-6">
            {Array.from({ length: under }, (_, j) => <div key={j} className="flex items-center gap-3"><SkeletonBlock className="h-7 w-7 shrink-0 rounded-full" /><SkeletonBlock className={`h-3 ${j % 2 ? 'w-32' : 'w-40'}`} /></div>)}
          </div>
        </div>
      ))}
    </SkeletonScreen>
  );
}
