// SERVER-ONLY. Master-only deactivation / reactivation of a person.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/activation.ts must never be imported into client code.');
}

import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, loadPerson, requireMaster } from '@/lib/hierarchy/authorize';
import { audit, eventIdOf } from '@/lib/audit';

export async function setActive(
  actor: SessionUser,
  personId: string,
  active: boolean
): Promise<{ personId: string; active: boolean }> {
  requireMaster(actor);
  if (personId === actor.personId) throw new HttpError(403, 'You cannot change your own active status.');

  const person = await loadPerson(personId);
  if (!person) throw new HttpError(404, 'Person not found.');
  // PENDING/REJECTED people are also active:false — reactivating them would bypass approval.
  if (person.registrationStatus !== 'APPROVED') {
    throw new HttpError(409, 'Only an approved person can be deactivated or reactivated.');
  }
  if (person.active === active) {
    throw new HttpError(409, active ? 'Already active.' : 'Already deactivated.');
  }

  // Auth first: on a partial failure deactivation fails closed, and a retry still works
  // because the Firestore flag hasn't flipped yet.
  await adminAuth.updateUser(personId, { disabled: !active });
  if (!active) await adminAuth.revokeRefreshTokens(personId);

  const batch = adminDb.batch();
  batch.update(adminDb.collection('people').doc(personId), {
    active,
    // Every QR issued before deactivation dies, and stays dead after reactivation.
    ...(active ? {} : { credentialVersion: FieldValue.increment(1) }),
  });
  audit(batch, { action: active ? 'PERSON_REACTIVATED' : 'PERSON_DEACTIVATED', actor, targetPersonId: personId, eventId: eventIdOf(person) });
  await batch.commit();

  return { personId, active };
}
