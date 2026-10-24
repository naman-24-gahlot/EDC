// Gate: entry, photo-ID record, on campus now, exit; and the installable app files. Uses a test
// person (…@qa.test). Creates test records — checkpoint first, clean afterwards (npm run test:data).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/gate.mts
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebase/admin';
import { nowInIST } from '@/lib/date';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const post = async (path: string, body: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? '' }; };
const get = async (path: string, cookie = '') => { const r = await fetch(`${B}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type') ?? '', text: (await r.text()).replace(/<!-- -->/g, '') }; };
const login = async (u: string) => (await post('/api/auth/session', { identifier: u, password: creds[u] })).cookie;

const master = await login('master'); const guard = await login('guard1');
const tag = Date.now().toString(36); const u = `qa.g${tag}`;
// confirm the email first (test addresses: link from the outbox)
await post('/api/register/email-check', { email: `${u}@qa.test` });
await new Promise((r) => setTimeout(r, 800));
const confirmLink = (await adminDb.collection('testOutbox').where('to', '==', `${u}@qa.test`).get()).docs[0]?.data().link as string;
await fetch(confirmLink.replace(/^https?:\/\/[^/]+/, B));
const reg = await post('/api/register', { firstName: 'QA', lastName: `Gate${tag}`, username: u, commEmail: `${u}@qa.test`, mobile: '9812345670', password: `Qa-${randomBytes(9).toString('base64url')}`, purpose: 'gate test', profileType: 'event_guest', eventToken: undefined, parentIdentifier: 'rahul' });
const id = reg.data?.personId as string;
await post(`/api/registrations/${id}/approve`, {}, master);
const person = (await adminDb.collection('people').doc(id).get()).data()!;
const code = `GUE${person.accessNumber}`;
// The event-guest default is 09:00–18:00 every day; outside those hours entry is (correctly) refused.
const inHours = nowInIST().time >= '09:00' && nowInIST().time < '18:00';

let r = await post('/api/guard/verify', { code, direction: 'IN' }, guard);
check(inHours ? 'entry approved' : 'entry outside hours refused (run 09:00–18:00 IST for the full test)', r.data?.approved === inHours, r.data?.reason);
if (inHours) {
  const entryId = r.data?.entryId as string;
  check('entry gives an id for the ID record, and no ID checked yet', !!entryId && r.data?.idCheck === null);
  check('full ID number refused', (await post('/api/guard/id-check', { entryId, type: 'Aadhaar', last4: '123456789012' }, guard)).status === 400);
  check('unknown ID kind refused', (await post('/api/guard/id-check', { entryId, type: 'Library card', last4: '1234' }, guard)).status === 400);
  check('members cannot record IDs', (await post('/api/guard/id-check', { entryId, type: 'Aadhaar', last4: '1234' }, master)).status === 403);
  r = await post('/api/guard/id-check', { entryId, type: 'Aadhaar', last4: 'ab12' }, guard);
  check('guard records "Aadhaar ending AB12"', r.status === 200, r.data);
  const saved = (await adminDb.collection('people').doc(id).get()).data()!.idCheck;
  check('only type and last 4 stored (plus who/when/which scan)', saved.type === 'Aadhaar' && saved.last4 === 'AB12' && Object.keys(saved).sort().join() === 'at,by,entryId,last4,type', Object.keys(saved));
  r = await post('/api/guard/verify', { code, direction: 'IN' }, guard);
  check('next scan shows the ID as checked', r.data?.idCheck?.type === 'Aadhaar' && r.data?.idCheck?.last4 === 'AB12');
  const denied = (await post('/api/guard/verify', { code: 'ZZZ00000', direction: 'IN' }, guard));
  check('an ID can’t be recorded against a refused scan', (await post('/api/guard/id-check', { entryId: denied.data?.entryId ?? 'nope', type: 'Aadhaar' }, guard)).status >= 400);
  let page = await get('/guard', guard);
  check('on campus now lists them', page.text.includes(`Gate${tag}`));
  r = await post('/api/guard/verify', { code, direction: 'OUT' }, guard);
  check('exit recorded', r.data?.exit === true && r.data?.approved === true, r.data);
  page = await get('/guard', guard);
  check('…and they leave the on-campus list', !page.text.includes(`Gate${tag}`));
}
r = await post('/api/guard/verify', { code: 'ZZZ00000', direction: 'OUT' }, guard);
check('exit with an unknown code records nothing', r.data?.approved === false && r.data?.exit === false);
const outs = (await adminDb.collection('entryEvents').where('personId', '==', id).get()).docs.map((d) => d.data()).filter((e) => e.direction === 'OUT');
check(inHours ? 'exit stored with direction OUT, result EXITED' : 'no exit stored (never entered)', inHours ? outs.length === 1 && outs[0].result === 'EXITED' : outs.length === 0);
check('entries page filters exits', (await get('/admin/entries?result=EXITED', master)).status === 200);
check('entries page shows on campus now and today’s register', (await get('/admin/entries', master)).text.includes('on campus now'));
check('person page shows the photo ID record', (await get(`/admin/people/${id}`, master)).text.includes(inHours ? 'photo ID seen: Aadhaar ending AB12' : 'photo ID not checked yet'));

// installable app
const mf = await get('/manifest.webmanifest');
check('web app manifest served', mf.status === 200 && JSON.parse(mf.text).short_name === 'EDC Access');
const icon = await get('/app-icon/192');
check('app icon rendered as PNG', icon.status === 200 && icon.type.includes('image/png'));
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(0);
