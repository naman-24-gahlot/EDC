import { PageSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageSkeleton rows={4} label="Loading your account…" />
    </main>
  );
}
