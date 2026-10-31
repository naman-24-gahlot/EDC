// SERVER-ONLY. Access-request lifecycle: PENDING → APPROVED | REJECTED | EXPIRED (3 days,
// lazily persisted). Never deleted. See DATABASE_SCHEMA.md "accessRequests".
if (typeof window !== 'undefined') {
  throw new Error('lib/access/requests.ts must never be imported into client code.');
}

import { Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, listDescendants, loadPerson, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { parseWindowPatch, planGrant, type EntitlementWindow } from './entitlements';
import { audit, eventIdOf } from '@/lib/audit';
import { after } from 'next/server';
import { siteOrigin } from '@/lib/origin';
import { notifyAccessApproved } from '@/lib/notify';
import { personTouched } from '@/lib/people/peopleIndex';

export const ACTIONABLE_MS = 3 * 24 * 60 * 60 * 1000;

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface AccessRequest {
  id: string;
  personId: string;
  requestedBy: string;
  purpose: string;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  status: RequestStatus;
  createdAt: Timestamp;
  actionableUntil: Timestamp;
  decidedBy: string | null;
  decidedAt: Timestamp | null;
  decisionNote: string | null;
  resultingEntitlementId: string | null;
  expiredMarkedAt: Timestamp | null;
  /** The person's event (people.eventId) when the request was made; for filtering. */
  eventId?: string | null;
}

const requests = () => adminDb.collection('accessRequests');

function toRequest(doc: DocumentSnapshot): AccessRequest {
  return { ...(doc.data() as Omit<AccessRequest, 'id'>), id: doc.id };
}

function isStale(r: Pick<AccessRequest, 'status' | 'actionableUntil'>, nowMs: number): boolean {
  return r.status === 'PENDING' && r.actionableUntil.toMillis() < nowMs;
}

function writeExpiry(tx: Transaction, r: AccessRequest, now: Timestamp) {
  tx.update(requests().doc(r.id), { status: 'EXPIRED', expiredMarkedAt: now });
  audit(tx, {
    action: 'ACCESS_REQUEST_EXPIRED', actor: 'system', targetPersonId: r.personId, subjectId: r.id, eventId: r.eventId ?? null, at: now,
    details: `not decided by ${r.actionableUntil.toDate().toISOString()}`,
  });
}

/**
 * Lazily persists EXPIRED on any PENDING request past actionableUntil. Called at the top
 * of every queue/history read; returns the list with statuses as they now are.
 */
export async function expireStaleRequests(list: AccessRequest[]): Promise<AccessRequest[]> {
  const now = Timestamp.now();
  const stale = list.filter((r) => isStale(r, now.toMillis()));
  if (stale.length === 0) return list;

  // One small transaction each, re-checking status, so concurrent readers expire (and
  // audit) a request exactly once.
  await Promise.all(
    stale.map((r) =>
      adminDb.runTransaction(async (tx) => {
        const fresh = toRequest(await tx.get(requests().doc(r.id)));
        if (isStale(fresh, now.toMillis())) writeExpiry(tx, fresh, now);
      })
    )
  );
  const ids = new Set(stale.map((r) => r.id));
  return list.map((r) => (ids.has(r.id) ? { ...r, status: 'EXPIRED' as const, expiredMarkedAt: now } : r));
}

async function requestsForPeople(personIds: string[]): Promise<AccessRequest[]> {
  const out: AccessRequest[] = [];
  for (let i = 0; i < personIds.length; i += 30) {
    const snap = await requests().where('personId', 'in', personIds.slice(i, i + 30)).get();
    out.push(...snap.docs.map(toRequest));
  }
  return out;
}

const newestFirst = (a: AccessRequest, b: AccessRequest) => b.createdAt.toMillis() - a.createdAt.toMillis();

/** A person's own requests, newest first, with lazy expiry applied. */
export async function listRequestsFor(personId: string): Promise<AccessRequest[]> {
  return (await expireStaleRequests(await requestsForPeople([personId]))).sort(newestFirst);
}

/**
 * The actor's approval queue: PENDING requests for people below them (Master: everyone),
 * never their own. Scoped by an ancestorIds query, then lazily expired.
 */
export async function listApprovalQueue(
  actor: SessionUser,
  /** Pass what the caller already loaded to skip re-reading it (same server-side scope). */
  known?: { self: PersonRecord | null; descendantIds: string[] }
): Promise<AccessRequest[]> {
  let candidates: AccessRequest[];
  if (actor.systemRole === 'master') {
    candidates = (await requests().where('status', '==', 'PENDING').get()).docs.map(toRequest);
  } else {
    const [self, below] = known
      ? [known.self, known.descendantIds]
      : await Promise.all([loadPerson(actor.personId), listDescendants(actor.personId).then((d) => d.map((p) => p.personId))]);
    if (!self || self.registrationStatus !== 'APPROVED' || self.active !== true) return [];
    candidates = (await requestsForPeople(below)).filter((r) => r.status === 'PENDING');
  }
  const current = await expireStaleRequests(candidates);
  return current
    .filter((r) => r.status === 'PENDING' && r.personId !== actor.personId)
    .sort((a, b) => a.actionableUntil.toMillis() - b.actionableUntil.toMillis());
}

export interface CreateRequestInput {
  personId: string;
  purpose: string;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
}

/** Parses untrusted request-creation input. personId defaults to the actor. Throws 400. */
export function parseCreateRequest(actor: SessionUser, body: unknown): CreateRequestInput {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const personId = raw.personId === undefined ? actor.personId : raw.personId;
  if (typeof personId !== 'string' || !personId) throw new HttpError(400, 'personId must be a person id.');
  const purpose = typeof raw.purpose === 'string' ? raw.purpose.trim() : '';
  if (!purpose) throw new HttpError(400, 'A purpose is required.');
  if (purpose.length > 500) throw new HttpError(400, 'Purpose is too long (500 characters max).');

  const dates = parseWindowPatch({
    ...('requestedStartDate' in raw && raw.requestedStartDate !== null ? { startDate: raw.requestedStartDate } : {}),
    ...('requestedEndDate' in raw && raw.requestedEndDate !== null ? { endDate: raw.requestedEndDate } : {}),
  });
  if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) {
    throw new HttpError(400, 'requestedEndDate cannot be before requestedStartDate.');
  }
  return { personId, purpose, requestedStartDate: dates.startDate ?? null, requestedEndDate: dates.endDate ?? null };
}

/** By the person themselves (approved + active) or by Master / an ancestor on their behalf. */
export async function createRequest(actor: SessionUser, input: CreateRequestInput): Promise<AccessRequest> {
  if (input.personId !== actor.personId) await assertCanActOn(actor, input.personId);

  const personRef = adminDb.collection('people').doc(input.personId);
  return adminDb.runTransaction(async (tx) => {
    const person = toPerson(await tx.get(personRef));
    if (!person) throw new HttpError(404, 'Person not found.');
    if (!person.profileType) throw new HttpError(400, 'Guards don\'t request access.');
    if (person.registrationStatus !== 'APPROVED' || person.active !== true) {
      throw new HttpError(409, 'Only an approved, active person can request access.');
    }

    const now = Timestamp.now();
    const existing = (await tx.get(requests().where('personId', '==', input.personId))).docs.map(toRequest);
    for (const r of existing.filter((r) => isStale(r, now.toMillis()))) writeExpiry(tx, r, now);
    if (existing.some((r) => r.status === 'PENDING' && !isStale(r, now.toMillis()))) {
      throw new HttpError(409, 'There is already a pending request for this person.');
    }

    const ref = requests().doc();
    const doc: Omit<AccessRequest, 'id'> = {
      personId: input.personId,
      requestedBy: actor.personId,
      purpose: input.purpose,
      requestedStartDate: input.requestedStartDate,
      requestedEndDate: input.requestedEndDate,
      status: 'PENDING',
      createdAt: now,
      actionableUntil: Timestamp.fromMillis(now.toMillis() + ACTIONABLE_MS),
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      resultingEntitlementId: null,
      expiredMarkedAt: null,
      eventId: eventIdOf(person),
    };
    tx.create(ref, doc);
    // Writing the person doc makes concurrent creates for the same person conflict and
    // retry, so the "one PENDING per person" check above can't be raced.
    tx.update(personRef, { lastRequestAt: now, ...personTouched() });
    audit(tx, { action: 'ACCESS_REQUEST_CREATED', actor, targetPersonId: input.personId, subjectId: ref.id, eventId: eventIdOf(person), at: now, details: input.purpose });
    return { ...doc, id: ref.id };
  });
}

/** Authorizes a decision: Master or an ancestor of the person — never the person themselves. */
async function loadForDecision(actor: SessionUser, requestId: string): Promise<AccessRequest> {
  const deny = new HttpError(403, 'Not authorized to decide this request.');
  if (!requestId || requestId.includes('/')) throw deny;
  const snap = await requests().doc(requestId).get();
  if (!snap.exists) throw actor.systemRole === 'master' ? new HttpError(404, 'Request not found.') : deny;
  const req = toRequest(snap);
  if (req.personId === actor.personId) throw new HttpError(403, 'You cannot decide a request for your own access.');
  await assertCanActOn(actor, req.personId);
  return req;
}

type Decision =
  | { kind: 'done'; requestId: string; status: 'APPROVED' | 'REJECTED'; entitlementId: string | null }
  | { kind: 'expired' };

async function decide(
  actor: SessionUser,
  requestId: string,
  approve: boolean,
  note: string | null,
  overrides: Partial<EntitlementWindow>
) {
  const req = await loadForDecision(actor, requestId);
  const ref = requests().doc(requestId);

  const result: Decision = await adminDb.runTransaction(async (tx) => {
    const fresh = toRequest(await tx.get(ref));
    if (fresh.status !== 'PENDING') throw new HttpError(409, `This request is already ${fresh.status}.`);
    const now = Timestamp.now();
    if (isStale(fresh, now.toMillis())) {
      writeExpiry(tx, fresh, now);
      return { kind: 'expired' };
    }

    // planGrant does its reads now (Firestore: all reads before any write).
    const plan = approve
      ? await planGrant(tx, actor, {
          personId: req.personId,
          sourceRequestId: requestId,
          overrides: {
            ...(fresh.requestedStartDate ? { startDate: fresh.requestedStartDate } : {}),
            ...(fresh.requestedEndDate ? { endDate: fresh.requestedEndDate } : {}),
            ...overrides,
          },
        })
      : null;

    tx.update(ref, {
      status: approve ? 'APPROVED' : 'REJECTED',
      decidedBy: actor.personId,
      decidedAt: now,
      decisionNote: note,
      resultingEntitlementId: plan?.entitlementId ?? null,
    });
    audit(tx, {
      action: approve ? 'ACCESS_REQUEST_APPROVED' : 'ACCESS_REQUEST_REJECTED', actor, targetPersonId: req.personId, subjectId: requestId,
      eventId: fresh.eventId ?? null, at: now, details: plan ? `entitlement ${plan.entitlementId}${note ? `; ${note}` : ''}` : note,
    });
    plan?.write();
    return { kind: 'done', requestId, status: approve ? 'APPROVED' : 'REJECTED', entitlementId: plan?.entitlementId ?? null };
  });

  if (result.kind === 'done' && result.entitlementId) {
    const origin = await siteOrigin();
    const id = result.entitlementId;
    after(() => notifyAccessApproved(id, origin).catch((e) => console.error('Access email failed', e)));
  }
  // Thrown after the transaction so the EXPIRED status it wrote is committed, not rolled back.
  if (result.kind === 'expired') {
    throw new HttpError(409, 'This request expired — it was not decided within 3 days.');
  }
  return { requestId: result.requestId, status: result.status, entitlementId: result.entitlementId };
}

export function approveRequest(actor: SessionUser, requestId: string, overrides: Partial<EntitlementWindow>, note: string | null) {
  return decide(actor, requestId, true, note, overrides);
}

export function rejectRequest(actor: SessionUser, requestId: string, note: string | null) {
  return decide(actor, requestId, false, note, {});
}
