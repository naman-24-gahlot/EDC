// SERVER-ONLY. One place for every "approve or reject" decision in the app, single or bulk.
// Each kind delegates to its own lib function, so authorization (assertCanActOn) and every
// business rule run per item exactly as for a single click. To add a new kind of decision,
// add an entry to KINDS — the API (/api/decisions) and the bulk UI pick it up.
if (typeof window !== 'undefined') {
  throw new Error('lib/decisions.ts must never be imported into client code.');
}

import type { SessionUser } from '@/lib/session';
import { HttpError } from '@/lib/hierarchy/authorize';
import { isProfileType, type ProfileType } from '@/lib/access/codes';
import { approveRequest, rejectRequest } from '@/lib/access/requests';
import { approveRegistration, rejectRegistration } from '@/lib/people/approveRegistration';

export type DecisionAction = 'approve' | 'reject';
export interface DecisionOptions {
  note: string | null;
  /** Registrations only: approve everyone selected as this type instead of what each applied for. */
  profileType?: ProfileType;
}

const KINDS = {
  registration: {
    approve: (actor: SessionUser, id: string, o: DecisionOptions) => approveRegistration(actor, id, o.profileType),
    reject: (actor: SessionUser, id: string, o: DecisionOptions) => rejectRegistration(actor, id, o.note),
  },
  request: {
    approve: (actor: SessionUser, id: string, o: DecisionOptions) => approveRequest(actor, id, {}, o.note),
    reject: (actor: SessionUser, id: string, o: DecisionOptions) => rejectRequest(actor, id, o.note),
  },
} as const;
export type DecisionKind = keyof typeof KINDS;
export const isDecisionKind = (k: unknown): k is DecisionKind => typeof k === 'string' && k in KINDS;

export const MAX_BULK = 100;
const ID_RE = /^[A-Za-z0-9]{1,128}$/;

export interface DecisionResult { id: string; ok: boolean; error?: string }

/** Validates untrusted input. Throws 400. */
export function parseDecisionBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isDecisionKind(b.kind)) throw new HttpError(400, 'Unknown kind of decision.');
  if (b.action !== 'approve' && b.action !== 'reject') throw new HttpError(400, 'action must be approve or reject.');
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)))] : [];
  if (ids.length === 0) throw new HttpError(400, 'Select at least one item.');
  if (ids.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} at a time.`);
  if (b.profileType !== undefined && !isProfileType(b.profileType)) throw new HttpError(400, 'Unknown profile type.');
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  return { kind: b.kind, action: b.action as DecisionAction, ids, options: { note, profileType: b.profileType as ProfileType | undefined } };
}

/**
 * Decides each item in turn (one at a time — each is its own transaction with its own audit
 * entry). One failure never stops the rest; the caller gets a result per item.
 */
export async function decideMany(actor: SessionUser, kind: DecisionKind, action: DecisionAction, ids: string[], options: DecisionOptions): Promise<DecisionResult[]> {
  const run = KINDS[kind][action];
  const results: DecisionResult[] = [];
  for (const id of ids) {
    try {
      await run(actor, id, options);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof HttpError ? err.message : 'Something went wrong.' });
      if (!(err instanceof HttpError)) console.error('Decision failed', kind, action, id, err);
    }
  }
  return results;
}
