// Admin-local copy — CLAUDE.md's convention is no cross-imports between the
// employee/admin/guard folders, so this intentionally duplicates
// app/employee/StatusDisplay.tsx's badge rather than sharing it.
const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  REVOKED: 'bg-red-100 text-red-800',
  CHECKED_IN: 'bg-blue-100 text-blue-800',
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-800';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{status}</span>
  );
}
