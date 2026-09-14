import { adminDb } from '@/lib/firebase/admin';
import { RequestActions } from './RequestActions';

interface PendingRequest {
  requestId: string;
  employeeName: string;
  date: string;
  requestedAt: string;
}

export default async function AdminPendingPage() {
  const snap = await adminDb.collection('requests').where('status', '==', 'PENDING').get();

  const pending: PendingRequest[] = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        requestId: doc.id,
        employeeName: data.employeeName as string,
        date: data.date as string,
        requestedAt: data.requestedAt?.toDate?.().toISOString() ?? '',
      };
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500">
        Pending requests ({pending.length})
      </h2>

      {pending.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing pending.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li key={r.requestId} className="rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{r.employeeName}</p>
                  <p className="text-xs text-gray-500">{r.date}</p>
                </div>
              </div>
              <RequestActions requestId={r.requestId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
