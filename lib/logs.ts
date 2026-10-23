// SERVER-ONLY. Filters for the audit log and gate entries, shared by the admin pages and their
// CSV exports so a download contains exactly what the filters show. Every combination below
// has a composite index in firestore.indexes.json.
if (typeof window !== 'undefined') {
  throw new Error('lib/logs.ts must never be imported into client code.');
}

import { Timestamp, type Query } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

// The action list and groups live with the writer (lib/audit.ts), so they can't drift apart.
import { ACTION_GROUPS, ACTIONS as ALL_ACTIONS } from '@/lib/audit';
export { ACTION_GROUPS };
export const ACTIONS: readonly string[] = ALL_ACTIONS;

const ID_RE = /^[A-Za-z0-9]{1,128}$/;
// Firestore allows at most 30 values in an "in" filter and 10 in "not-in".
const IN_LIMIT = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type Raw = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(',') : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const date = (v: string | string[] | undefined) => { const d = one(v); return d && DATE_RE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null; };

export interface LogFilter {
  person: string | null;
  /** An event id, 'none' (not from any event), or null (everything). Ignored with a person filter. */
  event: string | null;
  from: string | null; // YYYY-MM-DD, IST day
  to: string | null;
  order: 'desc' | 'asc';
}
export interface AuditFilter extends LogFilter { actions: string[] }
export interface EntryFilter extends LogFilter { result: 'APPROVED' | 'DENIED' | 'EXITED' | null }

function base(raw: Raw): LogFilter {
  const person = one(raw.person);
  const event = one(raw.event);
  return {
    person: person && ID_RE.test(person) ? person : null,
    event: event === 'none' || (event && ID_RE.test(event)) ? event : null,
    from: date(raw.from),
    to: date(raw.to),
    order: one(raw.order) === 'asc' ? 'asc' : 'desc',
  };
}

export function parseAuditFilter(raw: Raw): AuditFilter {
  const picked = [...new Set(list(raw.action).filter((a) => ACTIONS.includes(a)))];
  // All ticked = no filter. More than 30 ticked becomes "not one of the unticked" (auditQuery).
  return { ...base(raw), actions: picked.length === ACTIONS.length ? [] : picked };
}

export function parseEntryFilter(raw: Raw): EntryFilter {
  const r = one(raw.result);
  return { ...base(raw), result: r === 'APPROVED' || r === 'DENIED' || r === 'EXITED' ? r : null };
}

// Day boundaries in IST, as the office reads them.
const dayStart = (d: string) => Timestamp.fromDate(new Date(`${d}T00:00:00+05:30`));
const dayEnd = (d: string) => Timestamp.fromMillis(new Date(`${d}T00:00:00+05:30`).getTime() + 86_400_000);

/** Entries about one event's people (and the event itself), or about nobody's event. */
function withEvent(q: Query, f: LogFilter): Query {
  if (f.person || !f.event) return q;
  return q.where('eventId', '==', f.event === 'none' ? null : f.event);
}

function withDates(q: Query, f: LogFilter): Query {
  if (f.from) q = q.where('timestamp', '>=', dayStart(f.from));
  if (f.to) q = q.where('timestamp', '<', dayEnd(f.to));
  return q.orderBy('timestamp', f.order);
}

export function auditQuery(f: AuditFilter): Query {
  let q: Query = adminDb.collection('auditLogs');
  if (f.person) q = q.where('targetPersonId', '==', f.person);
  q = withEvent(q, f);
  if (f.actions.length === 1) q = q.where('action', '==', f.actions[0]);
  else if (f.actions.length > IN_LIMIT) q = q.where('action', 'not-in', ACTIONS.filter((x) => !f.actions.includes(x))); // nearly all ticked: exclude the few that aren't
  else if (f.actions.length > 1) q = q.where('action', 'in', f.actions);
  return withDates(q, f);
}

export function entryQuery(f: EntryFilter): Query {
  let q: Query = adminDb.collection('entryEvents');
  if (f.person) q = q.where('personId', '==', f.person);
  q = withEvent(q, f);
  if (f.result) q = q.where('result', '==', f.result);
  return withDates(q, f);
}

/** The filter back as URL params (for pager links, chips and the download link). */
export function filterParams(f: Partial<AuditFilter & EntryFilter>): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.actions?.length) out.action = f.actions.join(',');
  if (f.result) out.result = f.result;
  if (f.person) out.person = f.person;
  if (f.event) out.event = f.event;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.order === 'asc') out.order = 'asc';
  return out;
}

/**
 * One page of a filtered log, plus the total. `building` = Firestore is still creating the
 * index this filter needs (minutes after an index deploy) — pages say so instead of crashing.
 */
export async function runPaged(q: Query, page: number, size: number) {
  try {
    const [count, snap] = await Promise.all([q.count().get(), q.offset((page - 1) * size).limit(size).get()]);
    return { building: false as const, total: count.data().count, docs: snap.docs };
  } catch (err) {
    if ((err as { code?: number }).code === 9) return { building: true as const, total: 0, docs: [] };
    throw err;
  }
}
