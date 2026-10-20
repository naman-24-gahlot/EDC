// SERVER-ONLY. Master-only change of a person's parent, rewriting ancestorIds for the
// whole subtree atomically. See DATABASE_SCHEMA.md "Hierarchy rules".
if (typeof window !== 'undefined') {
  throw new Error('lib/hierarchy/rehome.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, MAX_DEPTH, computeAncestorIds, requireMaster, toPerson } from './authorize';

const TOP_LEVEL_PROFILE_TYPES = new Set(['employee', 'incubee']);

export async function rehome(
  actor: SessionUser,
  personId: string,
  newParentId: string | null
): Promise<{ parentId: string | null; ancestorIds: string[]; subtreeSize: number }> {
  requireMaster(actor);
  const people = adminDb.collection('people');

  return adminDb.runTransaction(async (tx) => {
    const person = toPerson(await tx.get(people.doc(personId)));
    if (!person) throw new HttpError(404, 'Person not found.');
    if (person.systemRole !== 'member') {
      throw new HttpError(400, 'Masters and guards are always top-level.');
    }
    if (newParentId === person.parentId) {
      throw new HttpError(409, 'Already under that parent.');
    }

    let newAncestors: string[];
    if (newParentId === null) {
      if (!person.profileType || !TOP_LEVEL_PROFILE_TYPES.has(person.profileType)) {
        throw new HttpError(400, 'Only an employee or incubee can be top-level.');
      }
      newAncestors = [];
    } else {
      if (newParentId === personId) throw new HttpError(400, 'A person cannot be their own parent.');
      const parent = toPerson(await tx.get(people.doc(newParentId)));
      if (!parent) throw new HttpError(400, 'New parent not found.');
      if (parent.ancestorIds.includes(personId)) {
        throw new HttpError(400, 'Cannot move a person under one of their own descendants.');
      }
      if (parent.profileType !== 'employee') {
        throw new HttpError(400, 'Only an employee can be a parent.');
      }
      if (parent.registrationStatus !== 'APPROVED' || parent.active !== true) {
        throw new HttpError(400, 'New parent must be an approved, active employee.');
      }
      newAncestors = computeAncestorIds(parent);
    }

    const descendants = (await tx.get(people.where('ancestorIds', 'array-contains', personId))).docs
      .map((doc) => toPerson(doc)!);

    const rewrites = descendants.map((d) => {
      const tail = d.ancestorIds.slice(d.ancestorIds.indexOf(personId));
      return { personId: d.personId, ancestorIds: [...newAncestors, ...tail] };
    });
    if (rewrites.some((r) => r.ancestorIds.length > MAX_DEPTH)) {
      throw new HttpError(400, `That move would push part of the subtree past depth ${MAX_DEPTH}.`);
    }

    tx.update(people.doc(personId), { parentId: newParentId, ancestorIds: newAncestors });
    for (const r of rewrites) tx.update(people.doc(r.personId), { ancestorIds: r.ancestorIds });
    tx.set(adminDb.collection('auditLogs').doc(), {
      action: 'HIERARCHY_CHANGED',
      actorId: actor.personId,
      actorRole: actor.systemRole,
      targetPersonId: personId,
      subjectId: null,
      timestamp: Timestamp.now(),
      details: `parent ${person.parentId ?? 'top-level'} → ${newParentId ?? 'top-level'}; ${rewrites.length} descendant(s) moved`,
    });

    return { parentId: newParentId, ancestorIds: newAncestors, subtreeSize: rewrites.length };
  });
}
