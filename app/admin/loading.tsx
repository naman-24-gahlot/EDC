import { PageSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return <PageSkeleton rows={4} label="Loading…" />;
}
