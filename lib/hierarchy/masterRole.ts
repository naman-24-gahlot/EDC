// SERVER-ONLY. Master promotion / demotion. Master is granted by another Master only —
// never self-applied — and the last active Master can never be demoted.
if (typeof window !== 'undefined') {
  throw new Error('lib/hierarchy/masterRole.ts must never be imported into client code.');
}

import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import type { SystemRole } from '@/lib/roles';
import { HttpError, requireMaster, toPerson } from './authorize';
import { audit, eventIdOf } from '@/lib/audit';

export async function setMasterRole(
  actor: SessionUser,
  targetPersonId: string,
  makeMaster: boolean
): Promise<{ personId: string; systemRole: SystemRole }> {
  requireMaster(actor);
  if (targetPersonId === actor.personId) {
    throw new HttpError(403, 'You cannot change your own Master status.');
  }
  const people = adminDb.collection('people');
  const newRole: SystemRole = makeMaster ? 'master' : 'member';

  const previousRole = await adminDb.runTransaction(async (tx) => {
    const target = toPerson(await tx.get(people.doc(targetPersonId)));
    if (!target) throw new HttpError(404, 'Person not found.');

    if (makeMaster) {
      if (target.systemRole === 'master') throw new HttpError(409, 'Already a Master.');
      if (target.systemRole !== 'member' || target.profileType !== 'employee') {
        throw new HttpError(400, 'Only an employee can be promoted to Master.');
      }
      if (target.registrationStatus !== 'APPROVED' || target.active !== true) {
        throw new HttpError(400, 'Only an approved, active employee can be promoted.');
      }
      if (target.parentId !== null) {
        throw new HttpError(400, 'Move this employee to top-level before promoting them.');
      }
    } else {
      if (target.systemRole !== 'master') throw new HttpError(409, 'Not a Master.');
      // Read inside the transaction so concurrent demotions serialize on these docs.
      const masters = (await tx.get(people.where('systemRole', '==', 'master'))).docs
        .filter((doc) => doc.data().active === true);
      if (masters.length <= 1) throw new HttpError(409, 'Cannot demote the last remaining Master.');
    }

    tx.update(people.doc(targetPersonId), { systemRole: newRole });
    audit(tx, { action: makeMaster ? 'MASTER_PROMOTED' : 'MASTER_DEMOTED', actor, targetPersonId, eventId: eventIdOf(target) });
    return target.systemRole;
  });

  // Authorization reads the custom claim, so it must follow. Revoking forces a fresh
  // sign-in, which is what makes a demotion take effect on an already-open session.
  try {
    // Merge, don't replace: a pending forced password change (mustChangePassword) must survive.
    const claims = (await adminAuth.getUser(targetPersonId)).customClaims ?? {};
    await adminAuth.setCustomUserClaims(targetPersonId, { ...claims, systemRole: newRole });
    await adminAuth.revokeRefreshTokens(targetPersonId);
  } catch (err) {
    await people.doc(targetPersonId).update({ systemRole: previousRole }).catch(() => {});
    throw err;
  }

  return { personId: targetPersonId, systemRole: newRole };
}
