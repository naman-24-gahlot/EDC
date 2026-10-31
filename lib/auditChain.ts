// SERVER-ONLY. Tamper-evident audit log — SECURITY_MODEL.md "Audit integrity". Every audit entry
// is "sealed" shortly after it is written: given the next sequence number and a keyed fingerprint
// (HMAC-SHA256) over its own contents and the previous entry's fingerprint. Editing a sealed entry,
// deleting one, or reordering them breaks the chain, and "Check integrity" on the audit page finds
// the first break. The key is derived from the server's existing QR_TOKEN_SECRET, so someone who
// can edit the database but not read the server's secrets can't forge new fingerprints. (Limit:
// deleting the newest entries AND rewinding the chain head together isn't detectable from the data
// alone — the head's count is shown so a drop can be noticed.)
//
// Where the seals are kept:
//   • Entries written before 2026-10-29 carry their own seal (`sealed: true, seq, prevHash, hash`).
//   • Newer entries are never touched again: each sealing pass writes ONE `auditSeals` record
//     listing the entries it sealed (ids + fingerprints, in order). That is ~1 write per entry
//     instead of ~3 (the entry, its seal update and the chain head every time).
// Which entries are waiting: newer entries carry `writtenAt` (the database's own commit time), and
// the head remembers the last one sealed (`mark`). Firestore reads are strongly consistent, so an
// entry committed later can't appear behind the mark; entries younger than SETTLE_MS are left for
// the next pass anyway. An entry that is behind the mark but in no seal was added straight to the
// database — the integrity check reports it.
//
// Sealing runs in one transaction on the `auditChain/head` doc, so concurrent sealers queue up
// instead of forking the chain. It's triggered after requests that write audit entries (at most
// every SEAL_EVERY_MS per server instance — lib/audit.ts), and before the audit page lists anything.
if (typeof window !== 'undefined') {
  throw new Error('lib/auditChain.ts must never be imported into client code.');
}

import { createHmac } from 'crypto';
import { FieldPath, Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

const HEAD = () => adminDb.collection('auditChain').doc('head');
const CHECKPOINT = () => adminDb.collection('auditChain').doc('verified');
const LOGS = () => adminDb.collection('auditLogs');
const SEALS = () => adminDb.collection('auditSeals');
const BATCH = 200; // entries per pass: one seal record stays small (~20 KB)
const SETTLE_MS = 10_000;
const GENESIS = 'genesis';
export const SEAL_EVERY_MS = 2 * 60_000;

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

const sealId = (fromSeq: number) => String(fromSeq).padStart(10, '0');

/**
 * One pass: seals up to BATCH waiting entries, oldest first. Returns how many it sealed.
 * `includeOld` also looks for old-shape entries (`sealed: false`) — none are written any more, so the
 * passes after each request skip that read; the audit page and scripts still check.
 */
export async function sealPending({ includeOld = false }: { includeOld?: boolean } = {}): Promise<number> {
  return adminDb.runTransaction(async (tx) => {
    const head = await tx.get(HEAD());
    const h = head.data() ?? {};
    let seq = Number(h.seq ?? 0);
    let prev = String(h.hash ?? GENESIS);

    // Entries in the old shape (from before seal records, or an old script): sealed on the entry itself, as before.
    if (includeOld) {
      const pending = await tx.get(LOGS().where('sealed', '==', false).orderBy('timestamp').limit(BATCH));
      if (!pending.empty) {
        for (const d of pending.docs) {
          seq += 1;
          const hash = fingerprint(prev, seq, d.data());
          tx.update(d.ref, { sealed: true, seq, prevHash: prev, hash });
          prev = hash;
        }
        tx.set(HEAD(), { ...h, seq, hash: prev, sealedAt: Timestamp.now() });
        return pending.size;
      }
    }

    // The mark, from the head — or from the newest seal record if the head lost it (an older
    // server version still running during a deploy rewrites the head without it).
    let mark: { at: Timestamp; id: string } | null = h.mark instanceof Timestamp && typeof h.markId === 'string' ? { at: h.mark, id: h.markId } : null;
    if (!mark) {
      const newest = (await tx.get(SEALS().orderBy('fromSeq', 'desc').limit(1))).docs[0]?.data();
      if (newest?.mark instanceof Timestamp && typeof newest.markId === 'string') mark = { at: newest.mark, id: newest.markId };
    }
    let q = LOGS().orderBy('writtenAt').orderBy(FieldPath.documentId()).limit(BATCH);
    if (mark) q = q.startAfter(mark.at, mark.id);
    const snap = await tx.get(q);
    const cutoff = (snap.readTime?.toMillis() ?? Date.now()) - SETTLE_MS;
    const due = snap.docs.filter((d) => (d.get('writtenAt') as Timestamp).toMillis() <= cutoff);
    if (due.length === 0) return 0;
    const fromSeq = seq + 1;
    const prevHash = prev;
    const ids: string[] = [];
    const hashes: string[] = [];
    for (const d of due) {
      seq += 1;
      prev = fingerprint(prev, seq, d.data());
      ids.push(d.id);
      hashes.push(prev);
    }
    const last = due[due.length - 1];
    const now = Timestamp.now();
    const newMark = { mark: last.get('writtenAt') as Timestamp, markId: last.id };
    tx.create(SEALS().doc(sealId(fromSeq)), { fromSeq, toSeq: seq, prevHash, hash: prev, ids, hashes, sealedAt: now, ...newMark });
    tx.set(HEAD(), { seq, hash: prev, sealedAt: now, ...newMark });
    return due.length;
  });
}

/** Seal everything waiting (loops in batches). Never throws — a failed seal is retried next time. */
export async function sealAll({ includeOld = true }: { includeOld?: boolean } = {}): Promise<void> {
  try {
    for (let i = 0; i < 50 && (await sealPending({ includeOld })) === BATCH; i++);
  } catch (err) {
    console.error('Audit sealing failed (will retry on the next write)', err);
  }
}

export interface ChainReport {
  /** Entries whose fingerprints were recomputed in this check. */
  checked: number;
  /** Incremental: the check started after entry #from (verified by an earlier check). */
  from: number;
  headSeq: number;
  unsealed: number;
  /** Entries whose text was blanked by an account deletion (still linked; contents not re-checkable). */
  redacted: number;
  /** The first problem found, or null if the chain is intact. */
  broken: { seq: number; entryId: string | null; problem: string } | null;
}

/**
 * Recomputes every fingerprint from #1 (`full`), or only those sealed since the last good check
 * (the default; falls back to full when there is no earlier check). Reads every entry it checks —
 * on demand only. A good result is remembered as the starting point for the next quick check.
 */
export async function verifyChain({ full = false }: { full?: boolean } = {}): Promise<ChainReport> {
  const [head, checkpoint] = await Promise.all([HEAD().get(), full ? null : CHECKPOINT().get()]);
  const h = head.data() ?? {};
  const headSeq = Number(h.seq ?? 0);
  const mark = h.mark instanceof Timestamp ? h.mark : null;
  const [legacyUnsealed, newUnsealed, newBehindMark] = await Promise.all([
    LOGS().where('sealed', '==', false).count().get(),
    mark ? LOGS().where('writtenAt', '>', mark).count().get() : LOGS().where('writtenAt', '>', Timestamp.fromMillis(0)).count().get(),
    mark ? LOGS().where('writtenAt', '<=', mark).count().get() : null,
  ]);
  const unsealed = legacyUnsealed.data().count + newUnsealed.data().count;

  // Where to start: after the last verified entry, if it is still where it was.
  const cp = checkpoint?.exists ? checkpoint.data() : null;
  const startOk = cp && typeof cp.seq === 'number' && typeof cp.hash === 'string' && cp.seq <= headSeq;
  let expected = startOk ? cp.seq + 1 : 1;
  let prev = startOk ? cp.hash as string : GENESIS;
  const from = expected - 1;
  let redacted = 0;
  const report = (broken: ChainReport['broken']): ChainReport => ({ checked: expected - 1 - from, from, headSeq, unsealed, redacted, broken });

  // Blanked entries must point at an ACCOUNT_DELETED entry that is part of the log (sealed, or
  // waiting to be sealed) — otherwise the blanking is an edit. Checked at the end, once all seals are known.
  const sealedNewIds = new Set<string>();
  const redactions: { seq: number; entryId: string; by: string }[] = [];
  const recheck = (seq: number, entryId: string, e: DocumentData): boolean => {
    const by = (e.redacted as { by?: unknown } | undefined)?.by;
    if (typeof by !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(by)) return false;
    redactions.push({ seq, entryId, by });
    redacted += 1;
    return true;
  };

  // 1. Entries that carry their own seal.
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let q = LOGS().where('sealed', '==', true).where('seq', '>=', expected).orderBy('seq').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) {
      const e = d.data();
      if (e.seq !== expected) return report({ seq: expected, entryId: null, problem: e.seq > expected ? `entry #${expected} is missing (deleted?)` : `entry #${e.seq} appears twice` });
      if (e.prevHash !== prev) return report({ seq: expected, entryId: d.id, problem: 'it no longer links to the entry before it' });
      if (e.hash !== fingerprint(prev, expected, e) && !recheck(expected, d.id, e)) return report({ seq: expected, entryId: d.id, problem: 'its contents were changed after it was sealed' });
      prev = e.hash;
      expected += 1;
    }
    if (snap.size < 500) break;
    last = snap.docs[snap.docs.length - 1];
  }

  // 2. Entries sealed by seal records. A quick check starts at a seal boundary (a past head).
  let lastSeal: DocumentSnapshot | null = null;
  for (;;) {
    let q = SEALS().where('fromSeq', '>=', expected).orderBy('fromSeq').limit(20);
    if (lastSeal) q = q.startAfter(lastSeal);
    const seals = await q.get();
    for (const s of seals.docs) {
      const seal = s.data() as { fromSeq: number; toSeq: number; prevHash: string; ids: string[]; hashes: string[] };
      if (seal.fromSeq !== expected) return report({ seq: expected, entryId: null, problem: seal.fromSeq > expected ? `entries #${expected}–${seal.fromSeq - 1} are missing (seal record deleted?)` : `entry #${seal.fromSeq} appears twice` });
      if (seal.prevHash !== prev) return report({ seq: expected, entryId: seal.ids[0] ?? null, problem: 'it no longer links to the entry before it' });
      const docs = seal.ids.length ? await adminDb.getAll(...seal.ids.map((id) => LOGS().doc(id))) : [];
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        if (!d.exists) return report({ seq: expected, entryId: d.id, problem: `entry #${expected} is missing (deleted?)` });
        const e = d.data()!;
        if (seal.hashes[i] !== fingerprint(prev, expected, e) && !recheck(expected, d.id, e)) return report({ seq: expected, entryId: d.id, problem: 'its contents were changed after it was sealed' });
        sealedNewIds.add(d.id);
        prev = seal.hashes[i];
        expected += 1;
      }
    }
    if (seals.size < 20) break;
    lastSeal = seals.docs[seals.docs.length - 1];
  }

  if (expected - 1 !== headSeq) return report({ seq: expected, entryId: null, problem: `the chain ends at #${expected - 1} but the head says #${headSeq} (entries deleted from the end?)` });
  if (head.exists && h.hash !== prev) return report({ seq: headSeq, entryId: null, problem: 'the chain head doesn’t match the last entry' });

  // 3. Every newer entry at or before the mark must be in a seal record (full check: counted exactly).
  if (newBehindMark && from === 0) {
    const inSeals = sealedNewIds.size;
    const behind = newBehindMark.data().count;
    if (behind > inSeals) return report({ seq: headSeq, entryId: null, problem: `${behind - inSeals} entr${behind - inSeals === 1 ? 'y was' : 'ies were'} added to the log without being sealed (written straight into the database?)` });
  }

  // 4. Blanked entries point at a real deletion record.
  for (const r of redactions) {
    const snap = await LOGS().doc(r.by).get();
    const e = snap.data();
    // Sealed on the entry, or a newer-style entry (sealed by a record, or still waiting: an entry
    // slipped in behind the mark without a seal is caught by step 3 of a full check).
    const inLog = !!e && (e.sealed === true || e.writtenAt instanceof Timestamp);
    if (!e || e.action !== 'ACCOUNT_DELETED' || !inLog) return report({ seq: r.seq, entryId: r.entryId, problem: 'its contents were changed after it was sealed' });
  }

  await CHECKPOINT().set({ seq: headSeq, hash: prev, at: Timestamp.now(), full: from === 0 }).catch(() => {});
  return report(null);
}
