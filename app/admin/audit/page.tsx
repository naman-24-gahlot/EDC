import { adminDb } from '@/lib/firebase/admin';

interface AuditRecord {
  logId: string;
  action: string;
  requestId: string | null;
  actorId: string;
  actorRole: string;
  targetEmployeeId: string | null;
  timestamp: string;
  details: string | null;
}

const ACTION_STYLES: Record<string, string> = {
  REQUEST_CREATED: 'bg-gray-100 text-gray-700',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  REVOKED: 'bg-red-100 text-red-800',
  CHECKED_IN: 'bg-blue-100 text-blue-800',
  CHECK_IN_DENIED: 'bg-yellow-100 text-yellow-800',
  EMPLOYEE_ADDED: 'bg-gray-100 text-gray-700',
  EMPLOYEE_DEACTIVATED: 'bg-red-100 text-red-800',
};

export default async function AdminAuditPage() {
  const [logsSnap, usersSnap] = await Promise.all([
    adminDb.collection('auditLogs').limit(300).get(),
    adminDb.collection('users').get(),
  ]);

  const names = new Map<string, string>();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    names.set(doc.id, (data.displayName as string) ?? data.email ?? doc.id);
  }

  const logs: AuditRecord[] = logsSnap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        logId: doc.id,
        action: data.action as string,
        requestId: (data.requestId as string | null) ?? null,
        actorId: data.actorId as string,
        actorRole: data.actorRole as string,
        targetEmployeeId: (data.targetEmployeeId as string | null) ?? null,
        timestamp: data.timestamp?.toDate?.().toISOString() ?? '',
        details: (data.details as string | null) ?? null,
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500">Audit log ({logs.length})</h2>

      {logs.length === 0 ? (
        <p className="text-sm text-gray-400">No activity yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {logs.map((log) => (
                <tr key={log.logId}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ACTION_STYLES[log.action] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    {names.get(log.actorId) ?? log.actorId} ({log.actorRole})
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    {log.targetEmployeeId ? (names.get(log.targetEmployeeId) ?? log.targetEmployeeId) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{log.details ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
