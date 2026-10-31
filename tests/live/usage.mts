// The request-saving changes of 2026-10-29: stay fields written at the gate, the guard screen's
// counts-only headline and on-demand list, the once-only overnight check, and audit sealing by
// seal records (incremental and full integrity checks, tamper and insertion detection). Uses a test
// person (…@qa.test) — checkpoint first, clean afterwards (npm run test:data).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/usage.mts
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { sealAll, verifyChain } from '@/lib/auditChain';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const post = async (path: string, body: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? '' }; };
const get = async (path: string, cookie = '') => { const r = await fetch(`${B}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' }); return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, '') }; };
const login = async (u: string) => (await post('/api/auth/session', { identifier: u, password: creds[u] })).cookie;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const master = await login('master'); const guard = await login('guard1');
const tag = Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]); const u = `qa.u${tag}`; // names are letters only
await post('/api/register/email-check', { email: `${u}@qa.test` });
await sleep(800);
const confirmLink = (await adminDb.collection('testOutbox').where('to', '==', `${u}@qa.test`).get()).docs[0]?.data().link as string;
await fetch(confirmLink.replace(/^https?:\/\/[^/]+/, B));
const reg = await post('/api/register', { firstName: 'QA', lastName: `Usage${tag}`, username: u, commEmail: `${u}@qa.test`, mobile: '9812345671', password: `Qa-${randomBytes(9).toString('base64url')}`, purpose: 'usage test', profileType: 'event_guest', parentIdentifier: 'rahul' });
const id = reg.data?.personId as string;
await post(`/api/registrations/${id}/approve`, {}, master);
const personRef = adminDb.collection('people').doc(id);
const code = `GUE${(await personRef.get()).data()!.accessNumber}`;
// All-day, every-day access so the test runs at any hour (gate-closing 23:59).
const ent = (await adminDb.collection('entitlements').where('personId', '==', id).get()).docs[0];
await ent.ref.update({ startTime: '00:00', endTime: '23:59', weekdays: [0, 1, 2, 3, 4, 5, 6] });

// ——— email live check no longer says "already registered"
const live = await get(`/api/register/check?email=${encodeURIComponent(`${u}@qa.test`)}`);
check('live email hint does not reveal a registered address', live.status === 200 && !/already registered/i.test(live.text), live.text);
const liveUser = await get(`/api/register/check?username=${u}`);
check('…the username hint still says taken', /taken/i.test(liveUser.text));
const send = await post('/api/register/email-check', { email: `${u}@qa.test` });
check('…requesting the confirmation link still says so', send.status === 400 && /already registered/i.test(send.data?.error ?? ''), send.data);

// ——— stay fields at the gate
let r = await post('/api/guard/verify', { code, direction: 'IN' }, guard);
check('entry approved', r.data?.approved === true, r.data?.reason);
let p = (await personRef.get()).data()!;
const midnight = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86_400_000))}T00:00:00+05:30`).getTime();
check('entry stores when the stay turns into a warning (midnight here: gate closes 23:59)', p.stayAlertAt instanceof Timestamp && p.stayAlertAt.toMillis() <= midnight, p.stayAlertAt?.toDate());
check('…and when an overnight flag falls due', p.overnightDueAt instanceof Timestamp && p.overnightDueAt.toMillis() === midnight && p.overnightOk === false);
let page = await get('/guard', guard);
const count = Number(page.text.match(/data-testid="on-campus-count">(\d+)/)?.[1] ?? -1);
check('guard screen: a count, no names', count >= 1 && !page.text.includes(`Usage${tag}`), count);
let list = await get('/api/guard/on-campus', guard);
check('opened list shows them, not flagged', list.text.includes(`Usage${tag}`) && /"overnight":false,"afterHours":false/.test(list.text.slice(list.text.indexOf(`Usage${tag}`))));

// ——— overnight: simulate "came in two days ago", still inside
const twoDaysAgo = Timestamp.fromMillis(Date.now() - 2 * 86_400_000);
await personRef.update({ lastEntryAt: twoDaysAgo, overnightDueAt: Timestamp.fromMillis(Date.now() - 60_000), stayAlertAt: Timestamp.fromMillis(Date.now() - 60_000) });
page = await get('/guard', guard);
check('guard screen counts the warning without reading anyone', page.text.includes('data-testid="stay-warnings"'));
await sleep(4000);
const flagId = `OVERNIGHT_${id}_${twoDaysAgo.toMillis()}`;
check('overnight flag raised by the guard-screen load', (await adminDb.collection('stayFlags').doc(flagId).get()).exists);
p = (await personRef.get()).data()!;
check('…and the person is no longer due (raised once)', p.overnightDueAt === undefined);
const before = (await personRef.get()).updateTime!.toMillis();
await get('/guard', guard); await sleep(3000);
check('a second load writes nothing for them', (await personRef.get()).updateTime!.toMillis() === before);

// ——— "legacy" person inside without stay fields: filled in when the list is opened
r = await post('/api/guard/verify', { code, direction: 'OUT' }, guard);
p = (await personRef.get()).data()!;
check('exit clears the stay fields', r.data?.exit === true && p.stayAlertAt === undefined && p.overnightDueAt === undefined && p.overnightOk === undefined);
await personRef.update({ onCampus: true, lastEntryAt: Timestamp.now() });
list = await get('/api/guard/on-campus', guard);
p = (await personRef.get()).data()!;
check('list fills in stay fields for someone inside from before', list.text.includes(`Usage${tag}`) && p.stayAlertAt instanceof Timestamp && p.overnightDueAt instanceof Timestamp);
await post('/api/guard/verify', { code, direction: 'OUT' }, guard);

// ——— audit sealing by seal records
await sleep(11_000); // entries younger than 10 s wait for the next pass
await sealAll();
const head = (await adminDb.collection('auditChain').doc('head').get()).data()!;
const newest = (await adminDb.collection('auditSeals').orderBy('fromSeq', 'desc').limit(1).get()).docs[0]?.data();
check('head carries the mark; the newest seal record ends at the head', head.mark instanceof Timestamp && newest?.toSeq === head.seq && newest?.hash === head.hash, { seq: head.seq, seal: newest?.fromSeq });
const mine = (await adminDb.collection('auditLogs').where('targetPersonId', '==', id).get()).docs;
check('this test’s entries are untouched (no seal fields on them) and all sealed in records', mine.length > 3 && mine.every((d) => d.get('sealed') === undefined && d.get('hash') === undefined) && mine.filter((d) => d.get('writtenAt')).length === mine.length, mine.length);

// Two full checks only (each reads the whole log): one with an entry slipped in, one clean.
const fake = adminDb.collection('auditLogs').doc();
await fake.set({ action: 'ENTRY_APPROVED', category: 'gate', actorId: 'x', actorRole: 'guard', targetPersonId: id, subjectId: null, eventId: null, timestamp: Timestamp.now(), details: 'QR', writtenAt: Timestamp.fromMillis(head.mark.toMillis() - 1000) });
let chain = await verifyChain({ full: true });
check('full check finds an entry slipped in behind the seals', /without being sealed/.test(chain.broken?.problem ?? ''), chain.broken);
await fake.delete();
chain = await verifyChain({ full: true });
check('full check: intact once removed', chain.broken === null && chain.checked === chain.headSeq, chain);
chain = await verifyChain();
check('quick check right after: nothing new, intact', chain.broken === null && chain.from === chain.headSeq && chain.checked === 0, chain);

// An edited entry: start the quick check just before the seal record holding it.
const victim = mine.find((d) => d.get('action') === 'ENTRY_APPROVED')!;
const original = victim.get('details');
const seal = (await adminDb.collection('auditSeals').where('ids', 'array-contains', victim.id).limit(1).get()).docs[0].data();
await adminDb.collection('auditChain').doc('verified').set({ seq: seal.fromSeq - 1, hash: seal.prevHash, at: Timestamp.now(), full: false });
await victim.ref.update({ details: 'tampered' });
chain = await verifyChain();
check('quick check finds an edited entry in its range', chain.broken?.entryId === victim.id && /changed/.test(chain.broken.problem), chain.broken);
await victim.ref.update({ details: original });
chain = await verifyChain();
check('…intact again once put back', chain.broken === null && chain.from === seal.fromSeq - 1, chain);

await post('/api/guard/verify', { code, direction: 'IN' }, guard);
await post('/api/guard/verify', { code, direction: 'OUT' }, guard);
await sleep(11_000);
await sealAll();
chain = await verifyChain();
check('quick check covers only the new entries', chain.broken === null && chain.from > 0 && chain.checked >= 2 && chain.from + chain.checked === chain.headSeq, chain);

const audit = await get('/admin/audit?verify=1', master);
check('audit page: quick check shown', audit.status === 200 && audit.text.includes('data-testid="chain-ok"'));
check('audit page offers the full check', (await get('/admin/audit', master)).text.includes('Full check'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
