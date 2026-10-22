// SERVER-ONLY. THE access rules — SECURITY_MODEL.md "Verification" steps 2–7, in order,
// first failure wins. The gate and the person's own pass screen both call this; there is
// no second implementation anywhere.
if (typeof window !== 'undefined') {
  throw new Error('lib/access/evaluate.ts must never be imported into client code.');
}

import { nowInIST, type IstNow } from '@/lib/date';
import type { PersonRecord } from '@/lib/hierarchy/authorize';
import { effectiveStatus, getCurrentEntitlement, type Entitlement } from './entitlements';

export type AccessDenialReason =
  | 'Account deactivated'
  | 'Access revoked'
  | 'Registration not approved'
  | 'No active access'
  | 'Access expired'
  | 'Access not yet active'
  | 'Outside permitted days'
  | 'Outside permitted hours';

export interface AccessDecision {
  allowed: boolean;
  reason: AccessDenialReason | null;
  entitlement: Entitlement | null;
}

/** Pure decision over already-loaded state. */
export function decideAccess(
  person: Pick<PersonRecord, 'active' | 'registrationStatus'>,
  entitlement: Entitlement | null,
  now: IstNow
): AccessDecision {
  const deny = (reason: AccessDenialReason): AccessDecision => ({ allowed: false, reason, entitlement });

  // Registration before active: PENDING people are also active:false, and "Account deactivated"
  // would be the wrong thing to tell them. Swapping changes the reason only, never the verdict.
  if (person.registrationStatus !== 'APPROVED') return deny('Registration not approved'); // 2
  if (person.active !== true) return deny('Account deactivated'); // 3 — the whole account is off, not just an access period
  if (!entitlement || entitlement.state === 'SUPERSEDED') return deny('No active access'); // 4

  switch (effectiveStatus(entitlement, now.date)) { // 5
    case 'REVOKED': return deny('Access revoked');
    case 'EXPIRED': return deny('Access expired');
    case 'SCHEDULED': return deny('Access not yet active');
  }
  if (!entitlement.weekdays.includes(now.weekday)) return deny('Outside permitted days'); // 6
  // [startTime, endTime): start inclusive, end exclusive. HH:MM compares correctly as text.
  if (now.time < entitlement.startTime || now.time >= entitlement.endTime) return deny('Outside permitted hours'); // 7

  return { allowed: true, reason: null, entitlement };
}

export async function evaluateAccess(person: PersonRecord, now: IstNow = nowInIST()): Promise<AccessDecision> {
  return decideAccess(person, await getCurrentEntitlement(person.personId), now);
}
