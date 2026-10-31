// Request savings: the events index and the people index (and their self-repair), the Master lists
// served from it (hierarchy, person page, My account, GET /api/people), and the requests badge. Creates a "QA" event — checkpoint first,
// clean afterwards (npm run test:data).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/savings.mts
import { readFileSync } from 'fs';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';
import { listEvents } from '@/lib/events';
import { pendingCounts } from '@/app/admin/data';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const call = async (method: string, path: string, body?: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }); const type = r.headers.get('content-type') ?? ''; return { status: r.status, data: type.includes('json') ? await r.json().catch(() => null) : null, text: type.includes('html') ? (await r.text()).replace(/<!-- -->/g, '') : '' }; };
const login = async (u: string) => { const r = await fetch(`${B}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ identifier: u, password: creds[u] }) }); return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? ''; };
const idOf = async (u: string) => (await adminDb.collection('people').where('username', '==', u).limit(1).get()).docs[0].id;
const tag = Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const [master, rahul, guard] = [await login('master'), await login('rahul'), await login('guard1')];
const index = adminDb.collection('eventsIndex').doc('all');

console.log('— events index');
const today = todayDateString();
let r = await call('POST', '/api/events', { name: `QA Index ${tag}`, details: 'a long description that stays out of the index', venue: '', accessFrom: today, accessTo: addDays(today, 1), gateOpens: '09:00', gateCloses: '18:00', linkExpiresAt: new Date(Date.now() + 86400_000).toISOString(), options: {} }, master);
const eventId = r.data?.id ?? r.data?.eventId;
let entry = (await index.get()).get(`events.${eventId}`);
check('a new event is in the index straight away, without its description', !!entry && entry.name === `QA Index ${tag}` && entry.details === undefined, entry && Object.keys(entry));
check('the events page lists it', (await call('GET', '/admin/events', undefined, master)).text.includes(`QA Index ${tag}`));
r = await call('PATCH', `/api/events/${eventId}`, { name: `QA Index ${tag} renamed` }, master);
entry = (await index.get()).get(`events.${eventId}`);
check('an edit updates the index in the same write', r.status === 200 && entry?.name === `QA Index ${tag} renamed`, entry?.name);
r = await call('PATCH', `/api/events/${eventId}`, { command: 'close' }, master);
check('closing the link shows in the index', (await index.get()).get(`events.${eventId}`)?.closedAt != null, r.status);
await index.update({ [`events.${eventId}`]: FieldValue.delete() }); // as if a script changed events behind the app's back
const listed = await listEvents();
check('an out-of-step index is rebuilt from the events', listed.some((e) => e.id === eventId) && !!(await index.get()).get(`events.${eventId}`));
check('people page filters by event from the index', (await call('GET', `/admin/people?ev=${eventId}`, undefined, master)).status === 200);

console.log('— people index (Master lists)');
const shards = () => Promise.all([0, 1, 2, 3].map((i) => adminDb.collection('peopleIndex').doc(String(i)).get()));
const rahulId = await idOf('rahul');
const vikram = await idOf('vikram.singh');
let page = await call('GET', '/admin/hierarchy', undefined, master);
check('hierarchy shows the whole tree again (from the index)', page.text.includes('data-node="rahul"') && page.text.includes('data-node="vikram.singh"'));
check('the index exists, and the Master’s list has everyone', (await shards()).every((s) => s.exists) && (await call('GET', '/api/people', undefined, master)).data?.people?.length === (await adminDb.collection('people').count().get()).data().count);
const pp = await call('GET', `/admin/people/${vikram}`, undefined, master);
check('person page lists possible parents inline again', pp.text.includes('id="pf-parent"') && pp.text.includes(`value="${rahulId}"`));
const everyone = (await adminDb.collection('people').count().get()).data().count - 1; // not the Master themselves
const shown = ((await call('GET', '/me', undefined, master)).text.match(/data-person="/g) ?? []).length;
check('Master “My account” lists everyone again (a full first page)', shown === Math.min(25, everyone), [shown, everyone]);
check('an employee’s “My account” still lists everyone under them', (await call('GET', '/me', undefined, rahul)).text.includes('vikram.singh'));
// A change made through the app shows at once (the person is "touched", read back with the index).
const before = (await adminDb.collection('people').doc(vikram).get()).data()!;
r = await call('PATCH', `/api/people/${vikram}`, { lastName: `Check${tag}` }, master);
const touched = (await adminDb.collection('people').doc(vikram).get()).get('touchedAt');
check('an edit stamps touchedAt', r.status === 200 && touched != null, r.status);
page = await call('GET', `/admin/people?q=vikram`, undefined, master);
check('…and the People page shows it straight away', page.status === 200);
const fromApi = (await call('GET', '/api/people', undefined, master)).data?.people?.find((p: { personId: string }) => p.personId === vikram);
check('GET /api/people (Master) has the change', fromApi?.lastName === `Check${tag}`, fromApi?.lastName);
await call('PATCH', `/api/people/${vikram}`, { lastName: before.lastName }, master);
// Someone the index doesn't know (written behind the app's back) → the count disagrees → rebuilt.
const shard = adminDb.collection('peopleIndex').doc(String(vikram.charCodeAt(0) % 4));
await shard.update({ [`people.${vikram}`]: FieldValue.delete() });
await adminDb.collection('people').doc(vikram).update({ touchedAt: Timestamp.fromMillis(0) }); // and not "touched" either
check('a missing person is noticed and the index rebuilt', (await call('GET', '/api/people', undefined, master)).data?.people?.some((p: { personId: string }) => p.personId === vikram) && !!(await shard.get()).get(`people.${vikram}`));
check('guards and anonymous can’t read the people list', (await call('GET', '/api/people', undefined, guard)).status === 403 && (await call('GET', '/api/people')).status === 401);

console.log('— pending-requests badge');
const counts = await pendingCounts();
const pending = (await adminDb.collection('accessRequests').where('status', '==', 'PENDING').get()).docs.filter((d) => d.get('actionableUntil')?.toMillis() > Date.now()).length;
check('badge counts actionable pending requests (with or without the new index)', counts.requests === pending, [counts.requests, pending]);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
