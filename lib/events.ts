// SERVER-ONLY. Campus events with a time-limited public registration link — DATABASE_SCHEMA.md
// "events". A Master creates the event; anyone with the link (/e/<token>) can register (any
// profile type) until the link expires or is closed; those registrations are tagged with the
// event and, once approved, get access for the event's dates and hours.
if (typeof window !== 'undefined') {
  throw new Error('lib/events.ts must never be imported into client code.');
}

import { randomBytes } from 'crypto';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, requireMaster } from '@/lib/hierarchy/authorize';
import { todayDateString } from '@/lib/date';
import type { EntitlementWindow } from '@/lib/access/entitlements';

export interface EventRecord {
  id: string;
  name: string;
  details: string;
  venue: string;
  accessFrom: string;   // YYYY-MM-DD — first day registrants may enter
  accessTo: string;     // YYYY-MM-DD — last day
  gateOpens: string;    // HH:MM
  gateCloses: string;   // HH:MM
  linkToken: string;    // the secret part of /e/<token>; replaced to kill old links
  linkExpiresAt: Timestamp;
  closedAt: Timestamp | null;
  createdBy: string;
  createdAt: Timestamp;
}

export type LinkState = 'OPEN' | 'CLOSED' | 'EXPIRED';
export const linkState = (e: Pick<EventRecord, 'closedAt' | 'linkExpiresAt'>, nowMs = Date.now()): LinkState =>
  e.closedAt ? 'CLOSED' : e.linkExpiresAt.toMillis() <= nowMs ? 'EXPIRED' : 'OPEN';

const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
const ID_RE = /^[A-Za-z0-9]{1,128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const newToken = () => randomBytes(12).toString('base64url');

const toEvent = (d: DocumentSnapshot): EventRecord | null => (d.exists ? ({ ...(d.data() as Omit<EventRecord, 'id'>), id: d.id }) : null);

/** The event behind a public link, or null for an unknown/malformed token. Never throws. */
export async function eventByToken(token: unknown): Promise<EventRecord | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const snap = await adminDb.collection('events').where('linkToken', '==', token).limit(1).get();
  return snap.empty ? null : toEvent(snap.docs[0]);
}

export async function loadEvent(id: string): Promise<EventRecord | null> {
  return ID_RE.test(id) ? toEvent(await adminDb.collection('events').doc(id).get()) : null;
}

export async function listEvents(): Promise<EventRecord[]> {
  const snap = await adminDb.collection('events').orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => toEvent(d)!);
}

/** The access period an approved registrant gets: the event's days, every weekday, its hours. */
export function eventWindow(e: EventRecord, today = todayDateString()): EntitlementWindow {
  return { startDate: e.accessFrom > today ? e.accessFrom : today, endDate: e.accessTo, weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: e.gateOpens, endTime: e.gateCloses };
}

// ---- input --------------------------------------------------------------------------------

const realDate = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface EventInput { name: string; details: string; venue: string; accessFrom: string; accessTo: string; gateOpens: string; gateCloses: string; linkExpiresAt: Timestamp }

/** Validates untrusted input. `partial` for edits: only the given fields, each still checked. */
export function parseEventInput(body: unknown, partial: false): EventInput;
export function parseEventInput(body: unknown, partial: true): Partial<EventInput>;
export function parseEventInput(body: unknown, partial: boolean): Partial<EventInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<EventInput> = {};
  const has = (k: string) => !partial || k in b;
  if (has('name')) { out.name = text(b.name, 120); if (!out.name) throw new HttpError(400, 'Give the event a name.'); }
  if (has('details')) out.details = text(b.details, 2000);
  if (has('venue')) out.venue = text(b.venue, 200);
  for (const k of ['accessFrom', 'accessTo'] as const) if (has(k)) {
    if (typeof b[k] !== 'string' || !realDate(b[k] as string)) throw new HttpError(400, 'Event dates must be real dates.');
    out[k] = b[k] as string;
  }
  for (const k of ['gateOpens', 'gateCloses'] as const) if (has(k)) {
    if (typeof b[k] !== 'string' || !TIME_RE.test(b[k] as string)) throw new HttpError(400, 'Gate times must be HH:MM.');
    out[k] = b[k] as string;
  }
  if (has('linkExpiresAt')) {
    const ms = typeof b.linkExpiresAt === 'string' ? Date.parse(b.linkExpiresAt) : NaN;
    if (Number.isNaN(ms)) throw new HttpError(400, 'Choose when the registration link stops working.');
    out.linkExpiresAt = Timestamp.fromMillis(ms);
  }
  return out;
}

function assertCoherent(e: Pick<EventInput, 'accessFrom' | 'accessTo' | 'gateOpens' | 'gateCloses'>) {
  if (e.accessTo < e.accessFrom) throw new HttpError(400, 'The last day cannot be before the first day.');
  if (e.gateOpens >= e.gateCloses) throw new HttpError(400, 'The gate must open before it closes.');
}

// ---- changes (Master only, each audited) ---------------------------------------------------

function audit(actor: SessionUser, action: string, eventId: string, details: string | null) {
  return adminDb.collection('auditLogs').doc().set({
    action, actorId: actor.personId, actorRole: actor.systemRole, targetPersonId: null, subjectId: eventId, timestamp: Timestamp.now(), details,
  });
}

export async function createEvent(actor: SessionUser, input: EventInput): Promise<EventRecord> {
  requireMaster(actor);
  assertCoherent(input);
  if (input.linkExpiresAt.toMillis() <= Date.now()) throw new HttpError(400, 'The link would already be expired — pick a later time.');
  const ref = adminDb.collection('events').doc();
  const now = Timestamp.now();
  const data = { ...input, linkToken: newToken(), closedAt: null, createdBy: actor.personId, createdAt: now, updatedAt: now };
  await ref.create(data);
  await audit(actor, 'EVENT_CREATED', ref.id, `${input.name}: ${input.accessFrom} → ${input.accessTo}, link until ${input.linkExpiresAt.toDate().toISOString()}`);
  return { ...data, id: ref.id };
}

export type EventCommand = 'close' | 'reopen' | 'new-link';

export async function updateEvent(actor: SessionUser, id: string, patch: Partial<EventInput>, command: EventCommand | null) {
  requireMaster(actor);
  const current = await loadEvent(id);
  if (!current) throw new HttpError(404, 'Event not found.');
  const merged = { ...current, ...patch };
  assertCoherent(merged);
  const changes: Record<string, unknown> = { ...patch, updatedAt: Timestamp.now() };
  let action = 'EVENT_UPDATED';
  if (command === 'close') { changes.closedAt = Timestamp.now(); action = 'EVENT_LINK_CLOSED'; }
  if (command === 'reopen') {
    if (merged.linkExpiresAt.toMillis() <= Date.now()) throw new HttpError(400, 'Set a new "link works until" time in the future to reopen it.');
    changes.closedAt = null; action = 'EVENT_LINK_REOPENED';
  }
  if (command === 'new-link') { changes.linkToken = newToken(); action = 'EVENT_LINK_REPLACED'; }
  if (Object.keys(changes).length === 1) throw new HttpError(400, 'Nothing changed.');
  await adminDb.collection('events').doc(id).update(changes);
  await audit(actor, action, id, Object.keys(patch).length ? `changed: ${Object.keys(patch).join(', ')}` : null);
  return { ...merged, ...changes } as EventRecord;
}

// ---- UTM-style source tags on registrations ------------------------------------------------

const TAG_RE = /^[A-Za-z0-9._-]{1,40}$/;
/** utm_source / utm_medium / utm_campaign from the link, kept only if they look like tags. */
export function parseSource(raw: unknown): { source: string | null; medium: string | null; campaign: string | null } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tag = (v: unknown) => (typeof v === 'string' && TAG_RE.test(v) ? v.toLowerCase() : null);
  return { source: tag(r.source), medium: tag(r.medium), campaign: tag(r.campaign) };
}
