import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { formatDateTime } from '@/lib/display';
import { allPeople, nameMap } from '../data';

export const dynamic = 'force-dynamic';

const LIMIT = 300;

function actionStyle(action: string): string {
  if (/REJECTED|REVOKED|DENIED|DEACTIVATED|DEMOTED/.test(action)) return 'bg-red-100 text-red-800';
  if (/APPROVED|CREATED|REACTIVATED|PROMOTED/.test(action)) return 'bg-green-100 text-green-800';
  if (/EXPIRED|SUPERSEDED|REISSUED/.test(action)) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const { action } = await searchParams;
  const [snap, people] = await Promise.all([
    adminDb.collection('auditLogs').orderBy('timestamp', 'desc').limit(LIMIT).get(),
    allPeople(),
  ]);
  const names = nameMap(people);
  const who = (id: string) => (id === 'system' || id === 'public' ? id : names.get(id) ?? id);
  const logs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const actions = [...new Set(logs.map((l) => String(l.action)))].sort();
  const shown = action ? logs.filter((l) => l.action === action) : logs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-gray-500">Audit log — most recent {logs.length}</h2>
        <form className="ml-auto">
          <select name="action" defaultValue={action ?? ''} aria-label="Filter by action" className="rounded border border-gray-300 px-2 py-1 text-xs">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="ml-1 rounded bg-gray-900 px-2 py-1 text-xs text-white">Filter</button>
        </form>
      </div>
      {shown.length === 0 ? <p className="text-sm text-gray-400">No activity.</p> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {shown.map((l) => {
                const ts = (l.timestamp as { toDate?: () => Date } | undefined)?.toDate?.();
                const target = l.targetPersonId as string | null;
                return (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{ts ? formatDateTime(ts) : '—'}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${actionStyle(String(l.action))}`}>{String(l.action)}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{who(String(l.actorId))} <span className="text-gray-400">({String(l.actorRole)})</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{target ? <Link href={`/admin/people/${target}`} className="hover:underline">{who(target)}</Link> : '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-400">{(l.subjectId as string | null) ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{(l.details as string | null) ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
