import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';

// Master only: download gate entries or the audit log as CSV for the office.
const LIMIT = 5000;

// Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as formulas, so a name or
// purpose typed at registration could otherwise run in whoever opens the file. Prefix them.
function cell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? '';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'master') return NextResponse.json({ error: 'Master only.' }, { status: 403 });

  const { kind } = await params;
  if (kind !== 'entries' && kind !== 'audit') return NextResponse.json({ error: 'Unknown export.' }, { status: 404 });

  const [rows, people] = await Promise.all([
    adminDb.collection(kind === 'entries' ? 'entryEvents' : 'auditLogs').orderBy('timestamp', 'desc').limit(LIMIT).get(),
    adminDb.collection('people').select('firstName', 'lastName', 'username').get(),
  ]);
  const name = new Map(people.docs.map((d) => [d.id, `${d.data().firstName} ${d.data().lastName} (@${d.data().username})`]));
  const who = (id: unknown) => (typeof id === 'string' ? name.get(id) ?? id : '');

  const lines =
    kind === 'entries'
      ? [
          ['time (UTC)', 'person', 'method', 'result', 'reason', 'code typed', 'guard'],
          ...rows.docs.map((d) => { const e = d.data(); return [iso(e.timestamp), who(e.personId), e.method, e.result, e.reason, e.presentedCode, who(e.guardUid)]; }),
        ]
      : [
          ['time (UTC)', 'action', 'by', 'by role', 'person', 'subject id', 'details'],
          ...rows.docs.map((d) => { const a = d.data(); return [iso(a.timestamp), a.action, who(a.actorId), a.actorRole, who(a.targetPersonId), a.subjectId, a.details]; }),
        ];
  const csv = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="edc-${kind}-${todayDateString()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
