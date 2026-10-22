// SERVER-ONLY. Entitlements: grant / revoke / edit, and the computed effective status.
// See DATABASE_SCHEMA.md "entitlements" and the Entitlement state machine.
if (typeof window !== 'undefined') {
  throw new Error('lib/access/entitlements.ts must never be imported into client code.');
}

import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';
import type { SessionUser } from '@/lib/session';
import type { ProfileType } from '@/lib/access/codes';
import { HttpError, assertCanActOn, toPerson } from '@/lib/hierarchy/authorize';
import { audit, eventIdOf, type AuditAction } from '@/lib/audit';

export type EntitlementState = 'ACTIVE' | 'REVOKED' | 'SUPERSEDED';
export type EffectiveStatus = EntitlementState | 'EXPIRED' | 'SCHEDULED';

export interface Entitlement {
  id: string;
  personId: string;
  profileTypeAtGrant: ProfileType;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  startTime: string;
  endTime: string;
  state: EntitlementState;
  sourceRequestId: string | null;
  approvedBy: string;
  approvedAt: Timestamp;
  revokedBy: string | null;
  revokedAt: Timestamp | null;
  revokeReason: string | null;
  createdAt: Timestamp;
}

interface Template {
  weekdays: number[];
  startTime: string;
  endTime: string;
  /** Inclusive day count; null = open-ended. */
  durationDays: number | null;
}

export const TEMPLATES: Record<ProfileType, Template> = {
  employee: { weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', durationDays: null },
  incubee: { weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', durationDays: 90 },
  event_guest: { weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00', durationDays: 2 },
  driver: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00', durationDays: 30 },
  relative: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00', durationDays: 30 },
  bodyguard: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00', durationDays: 30 },
};

/** The fields an approver may set on a grant or edit. */
export interface EntitlementWindow {
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  startTime: string;
  endTime: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Validates untrusted input field by field; only known keys survive. Throws 400. */
export function parseWindowPatch(input: unknown): Partial<EntitlementWindow> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid entitlement fields.');
  const raw = input as Record<string, unknown>;
  const patch: Partial<EntitlementWindow> = {};

  if ('startDate' in raw) {
    if (typeof raw.startDate !== 'string' || !isRealDate(raw.startDate)) throw new HttpError(400, 'startDate must be YYYY-MM-DD.');
    patch.startDate = raw.startDate;
  }
  if ('endDate' in raw) {
    if (raw.endDate !== null && (typeof raw.endDate !== 'string' || !isRealDate(raw.endDate))) {
      throw new HttpError(400, 'endDate must be YYYY-MM-DD or null.');
    }
    patch.endDate = raw.endDate as string | null;
  }
  if ('weekdays' in raw) {
    const w = raw.weekdays;
    if (!Array.isArray(w) || w.length === 0 || !w.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw new HttpError(400, 'weekdays must be a non-empty list of 0–6 (0 = Sunday).');
    }
    patch.weekdays = [...new Set(w as number[])].sort((a, b) => a - b);
  }
  for (const key of ['startTime', 'endTime'] as const) {
    if (key in raw) {
      if (typeof raw[key] !== 'string' || !TIME_RE.test(raw[key] as string)) throw new HttpError(400, `${key} must be HH:MM (24h).`);
      patch[key] = raw[key] as string;
    }
  }
  return patch;
}

function assertCoherent(w: EntitlementWindow): void {
  if (w.endDate !== null && w.endDate < w.startDate) throw new HttpError(400, 'endDate cannot be before startDate.');
  // Overnight windows aren't supported: the window is [startTime, endTime) within one day.
  if (w.startTime >= w.endTime) throw new HttpError(400, 'startTime must be earlier than endTime.');
}

export function templateWindow(profileType: ProfileType, startDate: string): EntitlementWindow {
  const t = TEMPLATES[profileType];
  return {
    startDate,
    endDate: t.durationDays === null ? null : addDays(startDate, t.durationDays - 1),
    weekdays: t.weekdays,
    startTime: t.startTime,
    endTime: t.endTime,
  };
}

export function effectiveStatus(ent: Pick<Entitlement, 'state' | 'startDate' | 'endDate'>, today: string): EffectiveStatus {
  if (ent.state !== 'ACTIVE') return ent.state;
  if (ent.endDate !== null && today > ent.endDate) return 'EXPIRED';
  if (today < ent.startDate) return 'SCHEDULED';
  return 'ACTIVE';
}

function toEntitlement(doc: DocumentSnapshot): Entitlement {
  return { ...(doc.data() as Omit<Entitlement, 'id'>), id: doc.id };
}

/** Every entitlement for a person, newest first (single-field query; sorted in code). */
export async function listEntitlements(personId: string): Promise<Entitlement[]> {
  const snap = await adminDb.collection('entitlements').where('personId', '==', personId).get();
  return snap.docs.map(toEntitlement).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

/**
 * Current entitlement (ACTIVE, else most recent) for each of `personIds` — chunked `in`
 * queries over just these people, so a page of 25 reads only their entitlements.
 */
export async function currentEntitlementsFor(personIds: string[]): Promise<Map<string, Entitlement>> {
  const byPerson = new Map<string, Entitlement[]>();
  const ids = [...new Set(personIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((c) => adminDb.collection('entitlements').where('personId', 'in', c).get()));
  for (const snap of snaps) for (const doc of snap.docs) {
    const e = toEntitlement(doc);
    byPerson.set(e.personId, [...(byPerson.get(e.personId) ?? []), e]);
  }
  const out = new Map<string, Entitlement>();
  for (const [id, list] of byPerson) {
    list.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    out.set(id, list.find((e) => e.state === 'ACTIVE') ?? list[0]);
  }
  return out;
}

export async function getActiveEntitlement(personId: string): Promise<Entitlement | null> {
  return (await listEntitlements(personId)).find((e) => e.state === 'ACTIVE') ?? null;
}

/**
 * The entitlement that decides access: the ACTIVE one if any, else the most recent one
 * (so a revocation reads as "Access revoked", not "No active access").
 */
export async function getCurrentEntitlement(personId: string): Promise<Entitlement | null> {
  const all = await listEntitlements(personId);
  return all.find((e) => e.state === 'ACTIVE') ?? all[0] ?? null;
}

function log(tx: Transaction, action: AuditAction, actor: SessionUser, personId: string, subjectId: string, eventId: string | null, details: string | null) {
  audit(tx, { action, actor, targetPersonId: personId, subjectId, eventId, details });
}

export interface GrantArgs {
  personId: string;
  sourceRequestId: string | null;
  overrides?: Partial<EntitlementWindow>;
}

/**
 * Two-phase grant for use inside a caller's transaction (Firestore requires all reads
 * before any write): this does the reads now and returns `write()` for the caller to run
 * after its own reads. Authorization is the caller's job — see grantEntitlement.
 */
export async function planGrant(tx: Transaction, actor: SessionUser, args: GrantArgs) {
  const person = toPerson(await tx.get(adminDb.collection('people').doc(args.personId)));
  if (!person) throw new HttpError(404, 'Person not found.');
  if (!person.profileType) throw new HttpError(400, 'Guards and accounts without a profile type have no entitlements.');
  if (person.registrationStatus !== 'APPROVED' || person.active !== true) {
    throw new HttpError(409, 'Access can only be granted to an approved, active person.');
  }
  const profileType = person.profileType;

  const window: EntitlementWindow = {
    ...templateWindow(profileType, args.overrides?.startDate ?? todayDateString()),
    ...args.overrides,
  };
  assertCoherent(window);

  const existing = await tx.get(adminDb.collection('entitlements').where('personId', '==', args.personId));
  const toSupersede = existing.docs.filter((d) => d.data().state === 'ACTIVE');
  const ref = adminDb.collection('entitlements').doc();

  return {
    entitlementId: ref.id,
    window,
    write() {
      const now = Timestamp.now();
      for (const d of toSupersede) {
        tx.update(d.ref, { state: 'SUPERSEDED' });
        log(tx, 'ENTITLEMENT_SUPERSEDED', actor, args.personId, d.id, eventIdOf(person), `by ${ref.id}`);
      }
      tx.create(ref, {
        personId: args.personId,
        profileTypeAtGrant: profileType,
        ...window,
        state: 'ACTIVE',
        sourceRequestId: args.sourceRequestId,
        approvedBy: actor.personId,
        approvedAt: now,
        revokedBy: null,
        revokedAt: null,
        revokeReason: null,
        createdAt: now,
      });
      log(tx, 'ENTITLEMENT_CREATED', actor, args.personId, ref.id, eventIdOf(person),
        `${window.startDate} → ${window.endDate ?? 'open'}, days ${window.weekdays.join('')}, ${window.startTime}–${window.endTime}`);
    },
  };
}

/** Master or an ancestor grants directly. Any ACTIVE entitlement becomes SUPERSEDED. */
export async function grantEntitlement(actor: SessionUser, args: GrantArgs) {
  await assertCanActOn(actor, args.personId);
  return adminDb.runTransaction(async (tx) => {
    const plan = await planGrant(tx, actor, args);
    plan.write();
    return { entitlementId: plan.entitlementId, ...plan.window };
  });
}

async function loadForChange(actor: SessionUser, entitlementId: string): Promise<Entitlement> {
  if (!entitlementId || entitlementId.includes('/')) throw new HttpError(404, 'Entitlement not found.');
  const snap = await adminDb.collection('entitlements').doc(entitlementId).get();
  // Same no-existence-leak rule as assertCanActOn: non-masters get 403 for unknown ids.
  if (!snap.exists) throw new HttpError(actor.systemRole === 'master' ? 404 : 403, actor.systemRole === 'master' ? 'Entitlement not found.' : 'Not authorized to act on this person.');
  const ent = toEntitlement(snap);
  await assertCanActOn(actor, ent.personId);
  return ent;
}

/** ACTIVE → REVOKED, and the person's credentialVersion++ so every issued QR dies. */
export async function revokeEntitlement(actor: SessionUser, entitlementId: string, reason: string | null) {
  const ent = await loadForChange(actor, entitlementId);
  const ref = adminDb.collection('entitlements').doc(entitlementId);
  await adminDb.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const eventId = eventIdOf((await tx.get(adminDb.collection('people').doc(ent.personId))).data());
    if (fresh.data()?.state !== 'ACTIVE') throw new HttpError(409, `Cannot revoke a ${fresh.data()?.state} entitlement.`);
    const now = Timestamp.now();
    tx.update(ref, { state: 'REVOKED', revokedBy: actor.personId, revokedAt: now, revokeReason: reason });
    tx.update(adminDb.collection('people').doc(ent.personId), { credentialVersion: FieldValue.increment(1) });
    log(tx, 'ENTITLEMENT_REVOKED', actor, ent.personId, entitlementId, eventId, reason);
  });
  return { entitlementId, state: 'REVOKED' as const };
}

/** Edit the window of an ACTIVE entitlement. No credentialVersion bump: rules are evaluated live. */
export async function editEntitlement(actor: SessionUser, entitlementId: string, patch: Partial<EntitlementWindow>) {
  const keys = Object.keys(patch) as (keyof EntitlementWindow)[];
  if (keys.length === 0) throw new HttpError(400, 'Nothing to change.');
  const ent = await loadForChange(actor, entitlementId);
  const ref = adminDb.collection('entitlements').doc(entitlementId);
  return adminDb.runTransaction(async (tx) => {
    const fresh = toEntitlement(await tx.get(ref));
    const eventId = eventIdOf((await tx.get(adminDb.collection('people').doc(ent.personId))).data());
    if (fresh.state !== 'ACTIVE') throw new HttpError(409, `Cannot edit a ${fresh.state} entitlement.`);
    const merged: EntitlementWindow = {
      startDate: fresh.startDate, endDate: fresh.endDate, weekdays: fresh.weekdays,
      startTime: fresh.startTime, endTime: fresh.endTime, ...patch,
    };
    assertCoherent(merged);
    // The form sends the whole period; record only what actually changed.
    const changed = keys.filter((k) => JSON.stringify(fresh[k]) !== JSON.stringify(merged[k]));
    if (changed.length === 0) throw new HttpError(400, 'Nothing changed.');
    tx.update(ref, { ...patch });
    log(tx, 'ENTITLEMENT_CHANGED', actor, ent.personId, entitlementId, eventId,
      changed.map((k) => `${k}: ${JSON.stringify(fresh[k])} → ${JSON.stringify(merged[k])}`).join('; '));
    return { entitlementId, ...merged };
  });
}
