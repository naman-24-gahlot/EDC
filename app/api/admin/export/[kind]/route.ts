import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';
import { listEvents } from '@/lib/events';
import { categoryOf } from '@/lib/audit';
import { auditQuery, entryQuery, fetchMerged, parseAuditFilter, parseEntryFilter } from '@/lib/logs';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

// Master only: download gate entries or the audit log as CSV for the office — filtered exactly
// like the page (lib/logs.ts): ?action=…&person=…&from=…&to=…&order=… / ?result=…
const LIMIT = 5000;

// Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as formulas, so a name or
// purpose typed at registration could otherwise run in whoever opens the file. Prefix them.
function cell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? '';

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'master') return NextResponse.json({ error: 'Master only.' }, { status: 403 });

  const { kind } = await params;
  if (kind !== 'entries' && kind !== 'audit') return NextResponse.json({ error: 'Unknown export.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const raw = Object.fromEntries([...new Set(sp.keys())].map((k) => [k, sp.getAll(k)]));
  let rows: QueryDocumentSnapshot[];
  try {
    const audit = parseAuditFilter(raw);
    const q = kind === 'entries' ? entryQuery(parseEntryFilter(raw)) : auditQuery(audit);
    rows = Array.isArray(q) ? await fetchMerged(q, LIMIT, audit.order) : (await q.limit(LIMIT).get()).docs;
  } catch (err) {
    // FAILED_PRECONDITION: the index for this filter is still building after a deploy.
    if ((err as { code?: number }).code === 9) return NextResponse.json({ error: 'This filter is still being prepared by the database — try again in a few minutes.' }, { status: 503 });
    throw err;
  }
  // Names for just the people in these rows (three fields each), not the whole table.
  const ids = [...new Set(rows.flatMap((d) => [d.get('personId'), d.get('guardUid'), d.get('actorId'), d.get('targetPersonId')]).filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9]{1,128}$/.test(x)))];
  const snaps = ids.length ? await adminDb.getAll(...ids.map((id) => adminDb.collection('people').doc(id)), { fieldMask: ['firstName', 'lastName', 'username'] }) : [];
  const name = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, `${s.get('firstName')} ${s.get('lastName')} (@${s.get('username')})`]));
  const who = (id: unknown) => (typeof id === 'string' ? name.get(id) ?? id : '');
  const eventName = new Map((await listEvents()).map((e) => [e.id, e.name]));
  const ev = (id: unknown) => (typeof id === 'string' ? eventName.get(id) ?? id : '');

  const lines =
    kind === 'entries'
      ? [
          ['time (UTC)', 'person', 'method', 'result', 'reason', 'code typed', 'event', 'guard'],
          ...rows.map((d) => { const e = d.data(); return [iso(e.timestamp), who(e.personId), e.method, e.result, e.reason, e.presentedCode, ev(e.eventId), who(e.guardUid)]; }),
        ]
      : [
          ['time (UTC)', 'action', 'category', 'by', 'by role', 'person', 'event', 'subject id', 'details'],
          ...rows.map((d) => { const a = d.data(); return [iso(a.timestamp), a.action, a.category ?? categoryOf(a.action), who(a.actorId), a.actorRole, who(a.targetPersonId), ev(a.eventId), a.subjectId, a.details]; }),
        ];
  const csv = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="edc-${kind}-${sp.size ? 'filtered-' : ''}${todayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
