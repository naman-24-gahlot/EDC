import type { Timestamp } from 'firebase-admin/firestore';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { VisitorForm } from '@/components/VisitorForm';
import { VisitorList } from '@/components/VisitorList';
import { accessCodeFor } from '@/lib/access/codes';
import { listVisitors, visitorPassUrl } from '@/lib/visitors';
import { namesFor, requireMasterPage, siteOrigin } from '../data';

export const dynamic = 'force-dynamic';

// Every visitor pass (latest 100), and a form to create one.
export default async function VisitorsPage() {
  const user = await requireMasterPage();
  const [visitors, origin] = await Promise.all([listVisitors(user), siteOrigin()]);
  const hosts = await namesFor(visitors.map((v) => v.hostId as string));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Visitor passes — latest 100</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      <VisitorForm />
      <VisitorList personHrefBase="/admin/people/" rows={visitors.map((v) => ({
        personId: v.personId, name: `${v.firstName} ${v.lastName}`, vvip: v.vvip === true, code: accessCodeFor('visitor', v.accessNumber as string),
        host: hosts.get(v.hostId as string) ?? null, createdAt: (v.createdAt as Timestamp | undefined)?.toDate() ?? null,
        passUrl: visitorPassUrl(origin, { personId: v.personId, credentialVersion: Number(v.credentialVersion ?? 1) }),
        onCampus: v.onCampus === true, lastEntryAt: (v.lastEntryAt as Timestamp | undefined)?.toDate() ?? null, active: v.active === true,
      }))} />
    </div>
  );
}
