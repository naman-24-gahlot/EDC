// SERVER-ONLY. Permanent account deletion — DATABASE_SCHEMA.md "Account deletion".
//
// Who: the person themselves (password re-entered), a Master (anyone), or a visitor's host (their
// visitor passes — visitors have no account). Refused while anyone is under them (move them first)
// and for the last Master (nobody could manage the system).
//
// What goes: the sign-in account and every record about the person — profile (photo included),
// profile history, usernames/emails, access number, entitlements, requests, gate records, stay
// alerts, leave, password fingerprints, email confirmations and every email log/outbox entry to
// their addresses. Their random id stays where other records point at it (who approved whom),
// meaningless once the profile is gone.
//
// The audit log isn't deleted (it's the tamper-evident record): an ACCOUNT_DELETED entry with no
// personal data is written and sealed first, then every older entry about them — or mentioning
// their name, username or emails — has its text blanked and is marked `redacted: { by: <that
// entry> }`. lib/auditChain.ts accepts a blanked entry only if it points at a sealed
// ACCOUNT_DELETED entry, so blanking can't be used to hide an edit.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/deleteAccount.ts must never be imported into client code.');
}

import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, loadPerson } from '@/lib/hierarchy/authorize';
import { passwordSignIn } from '@/lib/people/profile';
import { audit } from '@/lib/audit';
import { sealAll } from '@/lib/auditChain';
import { dropFromIndex } from '@/lib/people/peopleIndex';

export const REDACTED_TEXT = '[removed — account deleted]';

export async function deleteAccount(actor: SessionUser, personId: string, opts: { password?: unknown; confirm?: unknown }) {
  if (opts.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  const person = await loadPerson(personId);
  if (!person) throw new HttpError(actor.systemRole === 'master' ? 404 : 403, 'Person not found.');
  const self = actor.personId === personId;

  if (self) {
    if (person.hasAccount !== false) {
      const email = (await adminAuth.getUser(personId).catch(() => null))?.email;
      if (typeof opts.password !== 'string' || !email || !(await passwordSignIn(email, opts.password))) {
        throw new HttpError(403, 'That password isn’t right.');
      }
    }
  } else if (actor.systemRole !== 'master') {
    // A host may remove their own visitor passes; everyone else is Master only.
    if (person.profileType !== 'visitor') throw new HttpError(403, 'Only a Master can delete someone else’s account.');
    await assertCanActOn(actor, personId);
  }

  const under = await adminDb.collection('people').where('ancestorIds', 'array-contains', personId).count().get();
  if (under.data().count > 0) {
    throw new HttpError(409, `${under.data().count} ${under.data().count === 1 ? 'person is' : 'people are'} registered under ${self ? 'you' : 'them'} — a Master must move ${under.data().count === 1 ? 'them' : 'them'} to someone else (or delete them) first.`);
  }
  if (person.systemRole === 'master') {
    const masters = await adminDb.collection('people').where('systemRole', '==', 'master').count().get();
    if (masters.data().count <= 1) throw new HttpError(409, 'This is the only Master — make someone else a Master first.');
  }

  // 1. The record that it happened (no personal data), part of the chain so blanked entries can point at it.
  const deletionRef = await (async () => {
    await audit(null, {
      action: 'ACCOUNT_DELETED', actor, targetPersonId: personId,
      details: `${self ? 'deleted by themselves' : actor.systemRole === 'master' ? 'deleted by a Master' : 'visitor pass deleted by its host'} · was ${person.systemRole === 'member' ? person.profileType ?? 'member' : person.systemRole}`,
    });
    await sealAll();
    const snap = await adminDb.collection('auditLogs').where('targetPersonId', '==', personId).where('action', '==', 'ACCOUNT_DELETED').limit(1).get();
    return snap.docs[0]?.id ?? null;
  })();
  if (!deletionRef) throw new HttpError(503, 'Couldn’t record the deletion — nothing was deleted. Try again in a minute.');

  // 2. Everything about them.
  const emails = [person.commEmail, person.backupEmail, person.edcEmail].filter((e): e is string => typeof e === 'string' && !!e).map((e) => e.toLowerCase());
  const refs: DocumentReference[] = [];
  const add = (snaps: FirebaseFirestore.QuerySnapshot[]) => snaps.forEach((s) => refs.push(...s.docs.map((d) => d.ref)));
  const by = (col: string, field = 'personId') => adminDb.collection(col).where(field, '==', personId).get();
  add(await Promise.all([
    by('identifiers'), by('accessNumbers'), by('entitlements'), by('accessRequests'), by('entryEvents'),
    by('stayFlags'), by('leaveRequests'), by('emailLog'), by('testOutbox'),
    adminDb.collection('people').doc(personId).collection('profileHistory').get(),
    ...emails.flatMap((e) => [adminDb.collection('emailLog').where('to', '==', e).get(), adminDb.collection('testOutbox').where('to', '==', e).get()]),
  ]));
  refs.push(adminDb.collection('passwordHashes').doc(personId), ...emails.map((e) => adminDb.collection('emailChecks').doc(e)));
  if (person.hasAccount !== false) await adminAuth.deleteUser(personId).catch((err) => { if ((err as { code?: string }).code !== 'auth/user-not-found') throw err; });
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  for (let i = 0; i < unique.length; i += 400) {
    const batch = adminDb.batch();
    unique.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }

  // 3. Blank their personal details out of the audit log (one pass over it — deletions are rare).
  const needles = [person.username, `${person.firstName} ${person.lastName}`, ...emails, String(person.mobile ?? '')].filter((n) => n && n.length >= 4).map((n) => n.toLowerCase());
  const log = await adminDb.collection('auditLogs').select('targetPersonId', 'subjectId', 'details', 'action').get();
  const now = Timestamp.now();
  const toBlank = log.docs.filter((d) => d.id !== deletionRef && (
    d.get('targetPersonId') === personId
    || needles.some((n) => String(d.get('details') ?? '').toLowerCase().includes(n) || String(d.get('subjectId') ?? '').toLowerCase() === n)));
  for (let i = 0; i < toBlank.length; i += 400) {
    const batch = adminDb.batch();
    for (const d of toBlank.slice(i, i + 400)) {
      const subject = String(d.get('subjectId') ?? '');
      batch.update(d.ref, { details: REDACTED_TEXT, ...(subject.includes('@') ? { subjectId: null } : {}), redacted: { by: deletionRef, at: now } });
    }
    await batch.commit();
  }

  // 4. The profile itself last (and its line in the people index), so a failure part-way can simply be retried.
  const last = adminDb.batch();
  last.delete(adminDb.collection('people').doc(personId));
  dropFromIndex(last, personId);
  await last.commit();
  return { personId, deleted: unique.length + 1, auditEntriesBlanked: toBlank.length };
}
