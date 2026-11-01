import { PageSkeleton } from '@/components/Skeleton';

// Any admin page without its own loading.tsx: a title, filters and a list.
export default function Loading() {
  return <PageSkeleton rows={5} />;
}
