import { adminDb } from '@/lib/firebase/admin';
import { StatusBadge } from '../StatusBadge';
import { RevokeButton } from '../RevokeButton';

interface HistoryRecord {
  requestId: string;
  employeeName: string;
  date: string;
  status: string;
  checkedInAt: string | null;
}

const HISTORY_STATUSES = ['APPROVED', 'REJECTED', 'REVOKED', 'CHECKED_IN'];

export default async function AdminHistoryPage() {
  // Fetched without a status filter (avoids an `in` query needing a composite
  // index) and filtered/sorted in app code — fine at this prototype's data volume.
  const snap = await adminDb.collection('requests').limit(200).get();

  const history: HistoryRecord[] = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        requestId: doc.id,
        employeeName: data.employeeName as string,
        date: data.date as string,
        status: data.status as string,
        checkedInAt: data.checkedInAt?.toDate?.().toISOString() ?? null,
      };
    })
    .filter((r) => HISTORY_STATUSES.includes(r.status))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500">Entry history ({history.length})</h2>

      {history.length === 0 ? (
        <p className="text-sm text-gray-400">No resolved requests yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {history.map((r) => (
            <li key={r.requestId} className="flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm font-medium">{r.employeeName}</p>
                <p className="text-xs text-gray-500">{r.date}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                {r.status === 'APPROVED' && <RevokeButton requestId={r.requestId} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
