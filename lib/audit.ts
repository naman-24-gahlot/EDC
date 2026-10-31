// SERVER-ONLY. The one way to write an audit entry — DATABASE_SCHEMA.md "auditLogs". Every entry
// has the same shape, including its category (from the action) and the event it belongs to (when
// the person it's about registered through an event link), so the log can be filtered by either.
if (typeof window !== 'undefined') {
  throw new Error('lib/audit.ts must never be imported into client code.');
}

import { FieldValue, Timestamp, type Transaction, type WriteBatch } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { after } from 'next/server';
import { SEAL_EVERY_MS, sealAll } from '@/lib/auditChain';

// Every action the app writes, grouped. The group key is stored as `category`.
export const ACTION_GROUPS = [
  { key: 'gate', label: 'Gate', actions: ['ENTRY_APPROVED', 'ENTRY_DENIED', 'EXIT_RECORDED'] },
  { key: 'stays', label: 'Stays', actions: ['LATE_EXIT', 'OVERNIGHT_STAY', 'MISSED_EXIT_SCAN', 'STAY_FLAG_SEEN'] },
  { key: 'access', label: 'Access', actions: ['ACCESS_REQUEST_CREATED', 'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'ACCESS_REQUEST_EXPIRED', 'ENTITLEMENT_CREATED', 'ENTITLEMENT_CHANGED', 'ENTITLEMENT_REVOKED', 'ENTITLEMENT_SUPERSEDED'] },
  { key: 'people', label: 'People', actions: ['REGISTRATION_SUBMITTED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED', 'PROFILE_CREATED', 'PROFILE_UPDATED', 'PROFILE_TYPE_CHANGED', 'HIERARCHY_CHANGED', 'PERSON_DEACTIVATED', 'PERSON_REACTIVATED', 'GUARD_CREATED', 'MASTER_PROMOTED', 'MASTER_DEMOTED', 'VISITOR_PASS_CREATED', 'APPROVAL_NOTICE_SEEN', 'ACCOUNT_DELETED'] },
  { key: 'leave', label: 'Leave & holidays', actions: ['LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED', 'HOLIDAY_ADDED', 'HOLIDAY_REMOVED'] },
  { key: 'events', label: 'Events', actions: ['EVENT_CREATED', 'EVENT_UPDATED', 'EVENT_LINK_CLOSED', 'EVENT_LINK_REOPENED', 'EVENT_LINK_REPLACED'] },
  { key: 'security', label: 'Passwords & passes', actions: ['PASSWORD_CHANGED', 'PASSWORD_RESET', 'PASSWORD_RESET_EMAIL_SENT', 'EMAIL_VERIFIED', 'REGISTRATION_EMAIL_CONFIRMED', 'SIGNED_IN', 'SIGNED_OUT', 'SIGN_IN_LOCKED', 'TEST_DATA_CLEANED', 'ID_CHECKED', 'SESSIONS_REVOKED', 'CREDENTIAL_REISSUED', 'ORPHAN_AUTH_ACCOUNT_REMOVED'] },
] as const;
export type AuditAction = (typeof ACTION_GROUPS)[number]['actions'][number];
export type AuditCategory = (typeof ACTION_GROUPS)[number]['key'];
export const ACTIONS: readonly AuditAction[] = ACTION_GROUPS.flatMap((g) => g.actions);

export function categoryOf(action: string): AuditCategory | 'other' {
  return ACTION_GROUPS.find((g) => (g.actions as readonly string[]).includes(action))?.key ?? 'other';
}

type Actor = SessionUser | 'system' | 'public';

export interface AuditInput {
  action: AuditAction;
  actor: Actor;
  /** The person the entry is about, if any. */
  targetPersonId: string | null;
  /** The record it's about: request, entitlement, entry event or event id. */
  subjectId?: string | null;
  /** The event the person registered through (people.eventId), or the event itself. */
  eventId?: string | null;
  details?: string | null;
  at?: Timestamp;
}

/** The stored shape. Keep this the only place that builds it. */
export function auditDoc(e: AuditInput) {
  const actorId = typeof e.actor === 'string' ? e.actor : e.actor.personId;
  const actorRole = typeof e.actor === 'string' ? e.actor : e.actor.systemRole;
  return {
    action: e.action,
    category: categoryOf(e.action),
    actorId,
    actorRole,
    targetPersonId: e.targetPersonId,
    subjectId: e.subjectId ?? null,
    eventId: e.eventId ?? null,
    timestamp: e.at ?? Timestamp.now(),
    details: e.details ?? null,
    // The database's commit time: how the tamper-evident chain finds entries waiting to be sealed
    // (lib/auditChain.ts). Not part of the fingerprint.
    writtenAt: FieldValue.serverTimestamp(),
  };
}

// After the response (the entry is committed by then), seal what's waiting — at most once every
// SEAL_EVERY_MS per server instance, so one seal record covers many entries instead of each request
// paying for its own pass. Calls that arrive while a seal is running just ask for one more pass.
// Outside a request (scripts) after() isn't available: the entry is sealed by the next pass.
let running: Promise<void> | null = null;
let again = false;
let lastPass = 0;
function runSeal(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => { do { again = false; await sealAll({ includeOld: false }); } while (again); })().finally(() => { running = null; });
  return running;
}
function sealSoon() {
  if (Date.now() - lastPass < SEAL_EVERY_MS) return;
  try {
    after(runSeal);
    lastPass = Date.now();
  } catch { /* not in a request */ }
}

/** Adds the entry to a transaction or batch (committed with it), or writes it now. */
export function audit(writer: null, e: AuditInput): Promise<unknown>;
export function audit(writer: Transaction | WriteBatch, e: AuditInput): void;
export function audit(writer: Transaction | WriteBatch | null, e: AuditInput): Promise<unknown> | void {
  const ref = adminDb.collection('auditLogs').doc();
  sealSoon();
  if (!writer) return ref.set(auditDoc(e));
  (writer as WriteBatch).set(ref, auditDoc(e));
}

/** A person's event id, from a record already loaded. */
export const eventIdOf = (p: object | null | undefined): string | null => {
  const id = (p as { eventId?: unknown } | null | undefined)?.eventId;
  return typeof id === 'string' ? id : null;
};

/** When the person isn't loaded already (outside transactions only). */
export async function lookupEventId(personId: string): Promise<string | null> {
  const snap = await adminDb.collection('people').doc(personId).get();
  return eventIdOf(snap.data());
}
