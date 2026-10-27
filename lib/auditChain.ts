// SERVER-ONLY. Tamper-evident audit log — SECURITY_MODEL.md "Audit integrity". Each audit entry
// is written unsealed (`sealed: false`); shortly after, it is "sealed": given the next sequence
// number and a keyed fingerprint (HMAC-SHA256) over its own contents and the previous entry's
// fingerprint. Editing a sealed entry, deleting one, or reordering them breaks the chain, and
// "Check integrity" on the audit page finds the first break. The key is derived from the server's
// existing QR_TOKEN_SECRET, so someone who can edit the database but not read the server's
// secrets can't forge new fingerprints. (Limit: deleting the newest entries AND rewinding the
// chain head together isn't detectable from the data alone — the head's count is shown so a
// drop can be noticed.)
//
// Sealing runs in one transaction on the `auditChain/head` doc, so concurrent sealers queue up
// instead of forking the chain. It's triggered after each request that wrote an audit entry,
// and before the audit page lists anything.
if (typeof window !== 'undefined') {
  throw new Error('lib/auditChain.ts must never be imported into client code.');
}

import { createHmac } from 'crypto';
import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

const HEAD = () => adminDb.collection('auditChain').doc('head');
const BATCH = 200; // well inside a transaction's 500-write limit
const GENESIS = 'genesis';

function key(): Buffer {
  const secret = process.env.QR_TOKEN_SECRET;
  if (!secret) throw new Error('QR_TOKEN_SECRET is not set');
  return createHmac('sha256', secret).update('edc-audit-chain-v1').digest();
}

/** Exactly the fields the entry is about, in a fixed order — the thing being fingerprinted. */
function canonical(e: DocumentData): string {
  const ts = e.timestamp instanceof Timestamp ? e.timestamp.toMillis() : null;
  return JSON.stringify([e.action, e.category, e.actorId, e.actorRole, e.targetPersonId ?? null, e.subjectId ?? null, e.eventId ?? null, ts, e.details ?? null]);
}

export function fingerprint(prevHash: string, seq: number, e: DocumentData): string {
  return createHmac('sha256', key()).update(`${prevHash}|${seq}|${canonical(e)}`).digest('hex');
}

/** Seals up to BATCH waiting entries, oldest first. Returns how many it sealed. */
export async function sealPending(): Promise<number> {
  return adminDb.runTransaction(async (tx) => {
    const head = await tx.get(HEAD());
    const pending = await tx.get(adminDb.collection('auditLogs').where('sealed', '==', false).orderBy('timestamp').limit(BATCH));
    if (pending.empty) return 0;
    let seq = head.exists ? Number(head.get('seq')) : 0;
    let prev = head.exists ? String(head.get('hash')) : GENESIS;
    for (const d of pending.docs) {
      seq += 1;
      const hash = fingerprint(prev, seq, d.data());
      tx.update(d.ref, { sealed: true, seq, prevHash: prev, hash });
      prev = hash;
    }
    tx.set(HEAD(), { seq, hash: prev, sealedAt: Timestamp.now() });
    return pending.size;
  });
}

/** Seal everything waiting (loops in batches). Never throws — a failed seal is retried next time. */
export async function sealAll(): Promise<void> {
  try {
    for (let i = 0; i < 50 && (await sealPending()) === BATCH; i++);
  } catch (err) {
    console.error('Audit sealing failed (will retry on the next write)', err);
  }
}

export interface ChainReport {
  checked: number;
  headSeq: number;
  unsealed: number;
  /** Entries whose text was blanked by an account deletion (still linked; contents not re-checkable). */
  redacted: number;
  /** The first problem found, or null if the chain is intact. */
  broken: { seq: number; entryId: string | null; problem: string } | null;
}

/** Walks the whole chain from #1 and recomputes every fingerprint. Reads every entry: on demand only. */
export async function verifyChain(): Promise<ChainReport> {
  const [head, unsealed] = await Promise.all([HEAD().get(), adminDb.collection('auditLogs').where('sealed', '==', false).count().get()]);
  const headSeq = head.exists ? Number(head.get('seq')) : 0;
  let prev = GENESIS;
  let redacted = 0;
  const deletions = new Map<string, boolean>();
  const isDeletionRecord = async (id: string) => {
    if (!deletions.has(id)) {
      const snap = /^[A-Za-z0-9]{1,128}$/.test(id) ? await adminDb.collection('auditLogs').doc(id).get() : null;
      deletions.set(id, !!snap?.exists && snap.get('action') === 'ACCOUNT_DELETED' && snap.get('sealed') === true);
    }
    return deletions.get(id)!;
  };
  let expected = 1;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const fail = (seq: number, entryId: string | null, problem: string): ChainReport => ({ checked: expected - 1, headSeq, unsealed: unsealed.data().count, redacted, broken: { seq, entryId, problem } });
  for (;;) {
    let q = adminDb.collection('auditLogs').where('sealed', '==', true).orderBy('seq').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) {
      const e = d.data();
      if (e.seq !== expected) return fail(expected, null, e.seq > expected ? `entry #${expected} is missing (deleted?)` : `entry #${e.seq} appears twice`);
      if (e.prevHash !== prev) return fail(expected, d.id, 'it no longer links to the entry before it');
      if (e.hash !== fingerprint(prev, expected, e)) {
        // Blanked when an account was deleted (lib/people/deleteAccount.ts): accepted only if it
        // points at a real, sealed ACCOUNT_DELETED entry — otherwise it's an edit.
        const by = (e.redacted as { by?: unknown } | undefined)?.by;
        if (typeof by !== 'string' || !(await isDeletionRecord(by))) return fail(expected, d.id, 'its contents were changed after it was sealed');
        redacted += 1;
      }
      prev = e.hash;
      expected += 1;
    }
    if (snap.size < 500) break;
    last = snap.docs[snap.docs.length - 1];
  }
  if (expected - 1 !== headSeq) return fail(expected, null, `the chain ends at #${expected - 1} but the head says #${headSeq} (entries deleted from the end?)`);
  if (head.exists && head.get('hash') !== prev) return fail(headSeq, null, 'the chain head doesn’t match the last entry');
  return { checked: expected - 1, headSeq, unsealed: unsealed.data().count, redacted, broken: null };
}
