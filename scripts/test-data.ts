/**
 * LOCAL TESTING TOOL — checkpoint the database before a round of testing, then put it back.
 *
 *   npm run test:data -- checkpoint   save the time and a snapshot of every record (+ sign-in accounts)
 *   npm run test:data -- report       dry run: what was added and changed since the checkpoint
 *   npm run test:data -- clean --yes  delete what was added, put changed records back as they were
 *                                     (refuses if new people don't look like test accounts — qa.… or
 *                                     ….test — unless you add --include-real)
 *
 * Works by record id against the snapshot (not by time alone), so nothing created or edited
 * during testing is missed. The snapshot (.test-checkpoint.local.json) stays on this computer
 * and out of git — it holds personal data. Passwords can't be put back (Firebase never reveals
 * them): the report lists whose changed; use `npm run test:password -- <user> <password>`.
 * Without --yes, `clean` only reports. Real activity during the testing window is removed too —
 * read the report first.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { audit } from '@/lib/audit';
import { sealAll } from '@/lib/auditChain';

const FILE = '.test-checkpoint.local.json';
const COLLECTIONS = ['people', 'identifiers', 'accessNumbers', 'entitlements', 'accessRequests', 'entryEvents', 'auditLogs', 'events', 'passwordHashes', 'testOutbox', 'emailChecks', 'stayFlags', 'holidays', 'leaveRequests', 'emailLog', 'auditChain', 'auditSeals', 'eventsIndex'] as const;
const SUB = 'profileHistory'; // people/{id}/profileHistory/{id}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface AuthState { email: string | null; disabled: boolean; claims: Json }
interface Checkpoint {
  at: string;
  docs: Record<string, Record<string, Json>>; // path collection → id → data ("people/<id>/profileHistory" for subcollections)
  auth: Record<string, AuthState>;
}

// Firestore Timestamps survive the JSON round trip as { __ts: [seconds, nanos] }.
const toJson = (v: unknown): Json => {
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  return (v ?? null) as Json;
};
const fromJson = (v: Json): unknown => {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v && typeof v === 'object') {
    const ts = (v as { __ts?: [number, number] }).__ts;
    if (ts && Object.keys(v).length === 1) return new Timestamp(ts[0], ts[1]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromJson(x)]));
  }
  return v;
};
const same = (a: Json, b: Json) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v: Json): Json => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

async function readAll(): Promise<Pick<Checkpoint, 'docs' | 'auth'>> {
  const docs: Checkpoint['docs'] = {};
  for (const c of COLLECTIONS) {
    const snap = await adminDb.collection(c).get();
    docs[c] = Object.fromEntries(snap.docs.map((d) => [d.id, toJson(d.data())]));
  }
  for (const id of Object.keys(docs.people)) {
    const snap = await adminDb.collection('people').doc(id).collection(SUB).get();
    if (!snap.empty) docs[`people/${id}/${SUB}`] = Object.fromEntries(snap.docs.map((d) => [d.id, toJson(d.data())]));
  }
  const auth: Checkpoint['auth'] = {};
  let page: string | undefined;
  do {
    const r = await adminAuth.listUsers(1000, page);
    for (const u of r.users) auth[u.uid] = { email: u.email ?? null, disabled: u.disabled, claims: toJson(u.customClaims ?? {}) };
    page = r.pageToken;
  } while (page);
  return { docs, auth };
}

function diff(before: Checkpoint, now: Pick<Checkpoint, 'docs' | 'auth'>) {
  const added: { path: string; id: string; data: Json }[] = [];
  const changed: { path: string; id: string; data: Json }[] = [];
  for (const [path, docs] of Object.entries(now.docs)) {
    const old = before.docs[path] ?? {};
    for (const [id, data] of Object.entries(docs)) {
      if (!(id in old)) added.push({ path, id, data });
      else if (!same(old[id], data)) changed.push({ path, id, data: old[id] });
    }
  }
  // Records deleted since the checkpoint (rare — nothing in the app deletes) come back too.
  const removed: { path: string; id: string; data: Json }[] = [];
  for (const [path, docs] of Object.entries(before.docs)) for (const [id, data] of Object.entries(docs)) if (!now.docs[path]?.[id]) removed.push({ path, id, data });
  const newAccounts = Object.keys(now.auth).filter((uid) => !before.auth[uid]);
  const changedAccounts = Object.keys(now.auth).filter((uid) => before.auth[uid] && (before.auth[uid].disabled !== now.auth[uid].disabled || !same(before.auth[uid].claims, now.auth[uid].claims)));
  // A changed password fingerprint means that person's password changed during testing.
  const passwordChanged = changed.filter((c) => c.path === 'passwordHashes').map((c) => c.id)
    .concat(added.filter((a) => a.path === 'passwordHashes' && before.docs.people[a.id]).map((a) => a.id));
  return { added, changed, removed, newAccounts, changedAccounts, passwordChanged };
}

function label(before: Checkpoint, now: Pick<Checkpoint, 'docs'>, id: string) {
  const p = (now.docs.people[id] ?? before.docs.people[id]) as { firstName?: string; lastName?: string; username?: string } | undefined;
  return p ? `${p.firstName} ${p.lastName} (@${p.username})` : id;
}

async function main() {
  const [cmd, ...flags] = process.argv.slice(2);
  const flag = flags.includes('--yes') ? '--yes' : flags.includes('--replace') ? '--replace' : flags[0];
  if (cmd === 'checkpoint') {
    if (existsSync(FILE) && flag !== '--replace') throw new Error(`${FILE} already exists. Run "clean" first, or "checkpoint --replace" to start a new one (the old snapshot is lost).`);
    const state = await readAll();
    const cp: Checkpoint = { at: new Date().toISOString(), ...state };
    writeFileSync(FILE, JSON.stringify(cp));
    const counts = Object.entries(state.docs).filter(([p]) => !p.includes('/')).map(([p, d]) => `${p} ${Object.keys(d).length}`).join(', ');
    console.log(`Checkpoint saved at ${cp.at} (IST ${new Date(Date.parse(cp.at) + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ')}).\n  ${counts}; sign-in accounts ${Object.keys(state.auth).length}.`);
    return;
  }
  if (cmd !== 'report' && cmd !== 'clean') throw new Error('Usage: npm run test:data -- checkpoint | report | clean --yes');
  if (!existsSync(FILE)) throw new Error(`No checkpoint (${FILE}). Run "checkpoint" before testing.`);
  const before = JSON.parse(readFileSync(FILE, 'utf8')) as Checkpoint;
  const now = await readAll();
  const d = diff(before, now);

  console.log(`Since the checkpoint of ${before.at}:`);
  const byPath = (list: { path: string }[]) => Object.entries(list.reduce<Record<string, number>>((m, x) => ({ ...m, [x.path.includes('/') ? SUB : x.path]: (m[x.path.includes('/') ? SUB : x.path] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  console.log(`  added:    ${byPath(d.added)}`);
  console.log(`  changed:  ${byPath(d.changed)}`);
  if (d.removed.length) console.log(`  missing:  ${byPath(d.removed)}`);
  const newPeople = d.added.filter((a) => a.path === 'people').map((a) => label(before, now, a.id));
  if (newPeople.length) console.log(`  new people (${newPeople.length}): ${newPeople.join(', ')}`);
  const editedPeople = d.changed.filter((c) => c.path === 'people').map((c) => label(before, now, c.id));
  if (editedPeople.length) console.log(`  people edited (${editedPeople.length}): ${editedPeople.join(', ')}`);
  console.log(`  sign-in accounts: ${d.newAccounts.length} new, ${d.changedAccounts.length} changed (role / switched off)`);
  if (d.passwordChanged.length) console.log(`  passwords changed (can't be put back — use test:password): ${d.passwordChanged.map((id) => label(before, now, id)).join(', ')}`);

  // People who don't look like test accounts may be real sign-ups made during the testing window
  // (the live site shares this database). Never delete them without an explicit second flag.
  // Visitor passes don't choose a username: a .test email or a first name starting "QA" marks a test one.
  const looksTest = (p: { username?: string; commEmail?: string | null; profileType?: string; firstName?: string }) =>
    /^qa\./.test(p.username ?? '') || /\.test$/i.test(p.commEmail ?? '') || (p.profileType === 'visitor' && /^qa/i.test(p.firstName ?? ''));
  const realLooking = d.added.filter((a) => a.path === 'people' && !looksTest(a.data as { username?: string; commEmail?: string | null; profileType?: string; firstName?: string })).map((a) => label(before, now, a.id));
  // Sign-in accounts too: one without a test person (or a .test email) is not obviously ours.
  const testIds = new Set(d.added.filter((a) => a.path === 'people' && looksTest(a.data as { username?: string; commEmail?: string | null; profileType?: string; firstName?: string })).map((a) => a.id));
  for (const uid of d.newAccounts) if (!testIds.has(uid) && !/\.test$/i.test(now.auth[uid].email ?? '') && !d.added.some((a) => a.path === 'people' && a.id === uid)) realLooking.push(`sign-in account ${now.auth[uid].email ?? uid} (no profile)`);
  if (realLooking.length) console.log(`  ⚠ not obviously test data (${realLooking.length}): ${realLooking.join(', ')}`);

  if (cmd === 'report' || flag !== '--yes') {
    if (cmd === 'clean') console.log('\nNothing changed. Run "clean --yes" to delete the added records and put the changed ones back.');
    return;
  }
  if (realLooking.length && !flags.includes('--include-real')) {
    console.log(`\nStopped: ${realLooking.length} item(s) above don't look like test data (username "qa.…" or email "….test").\nIf they really are test data, run "clean --yes --include-real". Nothing was changed.`);
    return;
  }

  // ---- clean: delete added, restore changed and missing, then sign-in accounts
  let batch = adminDb.batch(); let n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = adminDb.batch(); n = 0; } };
  const ref = (path: string, id: string) => adminDb.collection(path).doc(id);
  for (const a of d.added) { batch.delete(ref(a.path, a.id)); if (++n === 400) await flush(); }
  for (const c of [...d.changed, ...d.removed]) { batch.set(ref(c.path, c.id), fromJson(c.data) as DocumentData); if (++n === 400) await flush(); }
  await flush();
  for (const uid of d.newAccounts) await adminAuth.deleteUser(uid);
  for (const uid of d.changedAccounts) {
    const s = before.auth[uid];
    await adminAuth.updateUser(uid, { disabled: s.disabled });
    await adminAuth.setCustomUserClaims(uid, fromJson(s.claims) as Record<string, unknown>);
    await adminAuth.revokeRefreshTokens(uid); // sessions made during testing carry the test-time role
  }
  // The audit log and its chain are back at the checkpoint; record that the clean-up happened.
  await audit(null, { action: 'TEST_DATA_CLEANED', actor: 'system', targetPersonId: null, details: `back to the checkpoint of ${before.at}: removed ${d.added.length} records and ${d.newAccounts.length} sign-in accounts, put back ${d.changed.length + d.removed.length} records` });
  await sealAll();
  console.log(`\nDone: deleted ${d.added.length} records and ${d.newAccounts.length} sign-in accounts; put back ${d.changed.length + d.removed.length} records and ${d.changedAccounts.length} accounts.`);
  console.log(`The checkpoint is kept, so you can test again and clean again. Delete ${FILE} when you're finished with it.`);
}

main().then(() => process.exit(0), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
