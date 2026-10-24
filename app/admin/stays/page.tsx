import Link from 'next/link';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { InfoTip } from '@/components/InfoTip';
import { StayFlagList } from '@/components/StayFlagList';
import { GRACE_MIN, STAY_LABEL, listFlags } from '@/lib/stays';
import { requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

// Every stay alert (latest 100): late exits, overnight stays, missed exit scans.
export default async function StaysPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireMasterPage();
  const all = (await searchParams).show === 'all';
  const flags = (await listFlags(user)).filter((f) => all || !f.seenAt);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-medium text-gray-500">
          Stay alerts — {all ? 'latest 100' : 'not yet seen'}
          <InfoTip label="About stay alerts">
            Raised by the gate: <b>left late</b> = exit scan more than {GRACE_MIN} min after their gate-closing time; <b>overnight</b> = still recorded inside after midnight, or left on a later day; <b>no exit scan</b> = came in again (an hour or more later) without scanning out in between. People whose access says “may stay overnight” are never flagged. Overnight and no-exit alerts are also emailed to the person’s parent (or to Masters for top-level people).
          </InfoTip>
        </h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      <p className="text-sm">
        <Link href={all ? '/admin/stays' : '/admin/stays?show=all'} className="underline">{all ? 'Show only unseen' : 'Show seen ones too'}</Link>
      </p>
      <StayFlagList personHrefBase="/admin/people/"
        flags={flags.map((f) => ({ id: f.id, kind: f.kind, label: STAY_LABEL[f.kind], personId: f.personId, personName: f.personName, detail: f.detail, createdAt: f.createdAt.toDate().toISOString(), seen: !!f.seenAt }))} />
    </div>
  );
}
