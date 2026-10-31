// SERVER-ONLY. The people index — DATABASE_SCHEMA.md "peopleIndex". Master pages that list
// everyone (People, Hierarchy, My account, the person page's parent list, GET /api/people) read
// this instead of every person record:
//
//   peopleIndex/{0..3}  { people: { [personId]: <LIST_FIELDS of that person> }, builtAt, fullAt }
//
// How it stays right without every write having to update it:
//   1. Every write to a person record also sets `touchedAt` (the database's commit time) —
//      spread `...personTouched()` into it. tests/unit/peopleIndex.test.ts fails if a file writes
//      person records without it.
//   2. A read takes the index plus the people touched since it was built (usually a handful),
//      and a count of all people: if the numbers disagree (someone added or removed some other
//      way, e.g. a script), it is rebuilt from the records.
//   3. When many people have been touched since, the merged result is written back ("folded").
//   4. Once an hour it is rebuilt from scratch anyway, as a safety net.
// So a list costs ~6 reads instead of one per person. Data shown is as of the read, like before.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/peopleIndex.ts must never be imported into client code.');
}

import { after } from 'next/server';
import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { LIST_FIELDS, type PersonRecord } from '@/lib/hierarchy/authorize';

const SHARDS = 4; // each index record holds ~1/4 of everyone; a record's limit is 1 MB (~2,000 people)
const FOLD_AFTER = 40; // people touched since the last build before the index is rewritten
const REBUILD_EVERY_MS = 60 * 60_000;
const shardRef = (i: number) => adminDb.collection('peopleIndex').doc(String(i));
const shardOf = (personId: string) => personId.charCodeAt(0) % SHARDS;
const people = () => adminDb.collection('people');

/** Spread into EVERY write to a person record: `{ ...patch, ...personTouched() }`. */
export const personTouched = () => ({ touchedAt: FieldValue.serverTimestamp() });

/** With an account deletion: take them out of the index in the same write. */
export function dropFromIndex(writer: FirebaseFirestore.WriteBatch, personId: string) {
  writer.set(shardRef(shardOf(personId)), { people: { [personId]: FieldValue.delete() } }, { merge: true });
}

const entryOf = (data: DocumentData) => Object.fromEntries(LIST_FIELDS.filter((f) => f !== 'personId' && data[f] !== undefined).map((f) => [f, data[f]]));
const toRecord = (personId: string, e: DocumentData): PersonRecord => ({ ...e, personId, ancestorIds: (e.ancestorIds as string[]) ?? [] } as PersonRecord);

async function write(map: Map<string, DocumentData>, builtAt: Timestamp, fullAt: Timestamp) {
  const shards = Array.from({ length: SHARDS }, () => ({} as Record<string, DocumentData>));
  for (const [id, e] of map) shards[shardOf(id)][id] = e;
  const batch = adminDb.batch();
  shards.forEach((s, i) => {
    const size = JSON.stringify(s).length;
    if (size > 800_000) console.error(`peopleIndex/${i} is ${size} bytes — near Firestore's 1 MB limit; raise SHARDS in lib/people/peopleIndex.ts`);
    batch.set(shardRef(i), { people: s, builtAt, fullAt });
  });
  await batch.commit();
}

async function rebuild(): Promise<PersonRecord[]> {
  const snap = await people().select(...LIST_FIELDS).get();
  const map = new Map(snap.docs.map((d) => [d.id, entryOf(d.data())]));
  const at = snap.readTime ?? Timestamp.now();
  await write(map, at, at).catch((e) => console.error('peopleIndex rebuild could not be saved', e));
  return snap.docs.map((d) => toRecord(d.id, entryOf(d.data())));
}

/** Everyone (LIST_FIELDS), for Master pages. */
export async function allPeopleIndexed(): Promise<PersonRecord[]> {
  const [shards, total] = await Promise.all([adminDb.getAll(...Array.from({ length: SHARDS }, (_, i) => shardRef(i))), people().count().get()]);
  const builtAt = shards.every((s) => s.exists && s.get('builtAt') instanceof Timestamp) ? Timestamp.fromMillis(Math.min(...shards.map((s) => (s.get('builtAt') as Timestamp).toMillis()))) : null;
  const fullAt = builtAt ? Math.min(...shards.map((s) => (s.get('fullAt') as Timestamp | undefined)?.toMillis() ?? 0)) : 0;
  if (!builtAt || Date.now() - fullAt > REBUILD_EVERY_MS) return rebuild();

  const delta = await people().where('touchedAt', '>', builtAt).select(...LIST_FIELDS).get();
  const map = new Map<string, DocumentData>();
  for (const s of shards) for (const [id, e] of Object.entries((s.get('people') ?? {}) as Record<string, DocumentData>)) map.set(id, e);
  for (const d of delta.docs) map.set(d.id, entryOf(d.data()));
  if (map.size !== total.data().count) {
    console.warn(`peopleIndex: ${map.size} indexed vs ${total.data().count} people — rebuilding`);
    return rebuild();
  }
  if (delta.size >= FOLD_AFTER) {
    const at = delta.readTime ?? Timestamp.now();
    const full = Timestamp.fromMillis(fullAt);
    const fold = () => write(map, at, full).catch((e) => console.error('peopleIndex fold failed', e));
    try { after(fold); } catch { await fold(); } // outside a request (scripts): just do it
  }
  return [...map].map(([id, e]) => toRecord(id, e));
}
