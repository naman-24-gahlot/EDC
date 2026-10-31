// Request savings of 2026-10-31: the events index (and its self-repair), hierarchy branches loaded
// when opened, the person page's parent list loaded on demand, Master's "My account" without a
// read of everyone, and the pending-requests badge. Creates a "QA" event — checkpoint first,
// clean afterwards (npm run test:data).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/savings.mts
import { readFileSync } from 'fs';
import { FieldValue } from 'firebase-admin/firestore';
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

console.log('— hierarchy');
const page = await call('GET', '/admin/hierarchy', undefined, master);
const rahulId = await idOf('rahul');
check('opens at the top level (Rahul shown, his people not yet)', page.text.includes('data-node="rahul"') && !page.text.includes('data-node="vikram.singh"'));
r = await call('GET', `/api/admin/hierarchy?parent=${rahulId}`, undefined, master);
check('opening Rahul loads the people under him', r.status === 200 && r.data?.kids?.some((k: { username: string }) => k.username === 'vikram.singh'), r.data?.kids?.length);
check('“Show everyone” still shows the whole tree', (await call('GET', '/admin/hierarchy?all=1', undefined, master)).text.includes('data-node="vikram.singh"'));
check('branches are Master only', (await call('GET', `/api/admin/hierarchy?parent=${rahulId}`, undefined, rahul)).status === 403 && (await call('GET', `/api/admin/hierarchy?parent=${rahulId}`, undefined, guard)).status === 403 && (await call('GET', `/api/admin/hierarchy?parent=${rahulId}`)).status === 401);

console.log('— person page parent list');
const vikram = await idOf('vikram.singh');
const pp = await call('GET', `/admin/people/${vikram}`, undefined, master);
check('person page shows the current parent with “Change…”', pp.text.includes('data-testid="change-parent"') && pp.text.includes('Rahul'));
r = await call('GET', `/api/people/${vikram}/eligible-parents`, undefined, master);
check('“Change…” lists approved, active employees (not themselves)', r.status === 200 && r.data.parents.length > 0 && r.data.parents.some((p: { id: string }) => p.id === rahulId) && !r.data.parents.some((p: { id: string }) => p.id === vikram), r.data?.parents?.length);
check('Rahul can’t be moved under someone below him', !(await call('GET', `/api/people/${rahulId}/eligible-parents`, undefined, master)).data.parents.some((p: { id: string }) => p.id === vikram));
check('parent list is Master only', (await call('GET', `/api/people/${vikram}/eligible-parents`, undefined, rahul)).status === 403);

console.log('— Master “My account”');
const me = await call('GET', '/me', undefined, master);
const total = (await adminDb.collection('people').count().get()).data().count - 1;
check('shows the newest people and the total, linking to the People page', me.text.includes('data-testid="master-recent"') && me.text.includes(`<b>${total}</b> people`) && me.text.includes('href="/admin/people"'), total);
check('an employee’s “My account” still lists everyone under them', (await call('GET', '/me', undefined, rahul)).text.includes('vikram.singh'));

console.log('— pending-requests badge');
const counts = await pendingCounts();
const pending = (await adminDb.collection('accessRequests').where('status', '==', 'PENDING').get()).docs.filter((d) => d.get('actionableUntil')?.toMillis() > Date.now()).length;
check('badge counts actionable pending requests (with or without the new index)', counts.requests === pending, [counts.requests, pending]);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
