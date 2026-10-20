// SERVER-ONLY. Credential state is just people.credentialVersion — see DATABASE_SCHEMA.md
// "Credential (no stored state)".
if (typeof window !== 'undefined') {
  throw new Error('lib/access/credential.ts must never be imported into client code.');
}

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { signPassToken } from '@/lib/qr-token';
import { assertCanActOn, HttpError, loadPerson, type PersonRecord } from '@/lib/hierarchy/authorize';

export function passTokenFor(person: Pick<PersonRecord, 'personId' | 'credentialVersion'>): string {
  return signPassToken(person.personId, person.credentialVersion);
}

/**
 * Bumps credentialVersion, killing every previously issued QR at once (e.g. a pass was
 * screenshotted or a phone was lost). Allowed for the person themselves, Master, or an ancestor.
 */
export async function reissueCredential(actor: SessionUser, personId: string): Promise<{ credentialVersion: number }> {
  if (personId !== actor.personId) await assertCanActOn(actor, personId);
  const ref = adminDb.collection('people').doc(personId);
  const batch = adminDb.batch();
  batch.update(ref, { credentialVersion: FieldValue.increment(1) });
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'CREDENTIAL_REISSUED',
    actorId: actor.personId,
    actorRole: actor.systemRole,
    targetPersonId: personId,
    subjectId: null,
    timestamp: Timestamp.now(),
    details: null,
  });
  await batch.commit();
  const person = await loadPerson(personId);
  if (!person) throw new HttpError(404, 'Person not found.');
  return { credentialVersion: person.credentialVersion };
}
