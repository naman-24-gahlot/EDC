import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { DecisionButtons } from '@/components/DecisionButtons';
import { formatDateTime } from '@/lib/display';
import { leaveRange, listLeaveFor } from '@/lib/leave';
import { requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const STYLE: Record<string, string> = { APPROVED: 'text-emerald-700', REJECTED: 'text-red-700', CANCELLED: 'text-gray-500' };

// Employees' leave: waiting for a decision first, then the latest decided.
export default async function LeavePage() {
  const user = await requireMasterPage();
  const all = await listLeaveFor(user);
  const pending = all.filter((l) => l.status === 'PENDING');
  const decided = all.filter((l) => l.status !== 'PENDING').slice(0, 50);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Leave — waiting for a decision ({pending.length})</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Nothing waiting.</p> : (
        <ul className="space-y-2" data-testid="leave-queue">
          {pending.map((l) => (
            <li key={l.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
              <p><b>{l.personName}</b> — {leaveRange(l)}</p>
              <p className="mb-2 text-xs text-gray-600">{l.reason} · asked {formatDateTime(l.createdAt.toDate())}</p>
              <DecisionButtons base={`/api/leave/${l.id}`} what={`leave for ${l.personName}`} />
            </li>
          ))}
        </ul>
      )}
      <h2 className="text-sm font-medium text-gray-500">Decided (latest 50)</h2>
      {decided.length === 0 ? <p className="text-sm text-gray-400">None yet.</p> : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
          {decided.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span><b>{l.personName}</b> — {leaveRange(l)} <span className="text-xs text-gray-500">{l.reason}</span></span>
              <span className={`text-xs font-semibold ${STYLE[l.status] ?? ''}`}>{l.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
