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

interface TodayRequest {
  status: string;
  reviewNote: string | null;
}

export function StatusCard({ request }: { request: TodayRequest }) {
  return (
    <div className="space-y-1 rounded border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Today&apos;s status</span>
        <StatusBadge status={request.status} />
      </div>
      {request.reviewNote && (
        <p className="text-sm text-gray-500">Note: {request.reviewNote}</p>
      )}
    </div>
  );
}
