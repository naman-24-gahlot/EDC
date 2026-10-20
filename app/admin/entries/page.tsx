import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { formatDateTime } from '@/lib/display';
import { StatusPill } from '@/components/StatusPill';
import { allPeople, nameMap, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const LIMIT = 300;

export default async function AdminEntriesPage() {
  await requireMasterPage();
  const [snap, people] = await Promise.all([
    adminDb.collection('entryEvents').orderBy('timestamp', 'desc').limit(LIMIT).get(),
    allPeople(),
  ]);
  const names = nameMap(people);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500">Gate entries — most recent {snap.size}{snap.size === LIMIT ? ` (latest ${LIMIT})` : ''}</h2>
      {snap.empty ? <p className="text-sm text-gray-400">No gate activity yet.</p> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Guard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {snap.docs.map((d) => {
                const e = d.data();
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDateTime(e.timestamp.toDate())}</td>
                    <td className="px-3 py-2">
                      {e.personId ? <Link href={`/admin/people/${e.personId}`} className="hover:underline">{names.get(e.personId) ?? e.personId}</Link> : <span className="text-gray-400">unresolved</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{e.method}{e.presentedCode ? <span className="font-mono"> {e.presentedCode}</span> : ''}</td>
                    <td className="px-3 py-2"><StatusPill status={e.result} /></td>
                    <td className="px-3 py-2 text-xs">{e.reason ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{names.get(e.guardUid) ?? e.guardUid}</td>
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
