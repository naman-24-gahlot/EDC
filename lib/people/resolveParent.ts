// SERVER-ONLY. Resolves a controlling employee named by username OR access code
// (e.g. "rahul" or "EDC25166") to their personId, for public registration of
// subordinate profile types. Only ever returns an approved, active employee — never
// a raw client-supplied id. See SECURITY_MODEL.md "never trust... parentId".
if (typeof window !== 'undefined') {
  throw new Error('lib/people/resolveParent.ts must never be imported into client code.');
}

import { adminDb } from '@/lib/firebase/admin';
import { PREFIX, type ProfileType } from '@/lib/access/codes';

const CODE_RE = /^([A-Za-z]{3})(\d{5})$/;

export async function resolveEmployeeParent(identifierOrCode: string): Promise<string | null> {
  const raw = identifierOrCode.trim();
  if (!raw) return null;

  let candidateId: string | null = null;

  const codeMatch = raw.match(CODE_RE);
  if (codeMatch) {
    const [, prefix, digits] = codeMatch;
    const numberSnap = await adminDb.collection('accessNumbers').doc(digits).get();
    const numberPersonId = numberSnap.data()?.personId;
    if (typeof numberPersonId === 'string') {
      const personSnap = await adminDb.collection('people').doc(numberPersonId).get();
      const profileType = personSnap.data()?.profileType as ProfileType | null | undefined;
      // A stale/superseded code's prefix no longer matches the person's CURRENT type.
      if (profileType && PREFIX[profileType] === prefix.toUpperCase()) {
        candidateId = numberPersonId;
      }
    }
  } else {
    const idSnap = await adminDb.collection('identifiers').doc(raw.toLowerCase()).get();
    const idPersonId = idSnap.data()?.personId;
    if (typeof idPersonId === 'string') candidateId = idPersonId;
  }

  if (!candidateId) return null;

  const personSnap = await adminDb.collection('people').doc(candidateId).get();
  const person = personSnap.data();
  if (!person) return null;
  if (person.profileType !== 'employee') return null;
  if (person.registrationStatus !== 'APPROVED') return null;
  if (person.active !== true) return null;

  return candidateId;
}
