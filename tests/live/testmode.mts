// Testing mode (lib/testMode.ts): Master-only switch; test addresses, optional registration fields
// and the Turnstile skip follow it. Always leaves testing mode ON (the other live tests need it).
// Creates .test people — checkpoint first, clean afterwards (npm run test:data).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/testmode.mts
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const call = async (method: string, path: string, body?: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }); const type = r.headers.get('content-type') ?? ''; return { status: r.status, data: type.includes('json') ? await r.json().catch(() => null) : null, text: type.includes('html') ? (await r.text()).replace(/<!-- -->/g, '') : '' }; };
const login = async (u: string) => { const r = await fetch(`${B}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ identifier: u, password: creds[u] }) }); return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? ''; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const [master, rahul, guard] = [await login('master'), await login('rahul'), await login('guard1')];
const setMode = (on: boolean, who = master) => call('PATCH', '/api/settings', { testMode: on }, who);
const settle = () => sleep(11_000); // each server (and route) remembers the setting for up to 10 s

try {
  console.log('— the switch');
  check('only a Master can change it', (await setMode(false, rahul)).status === 403 && (await setMode(false, guard)).status === 403 && (await setMode(false, '')).status === 401);
  check('a bad value is refused', (await call('PATCH', '/api/settings', { testMode: 'yes' }, master)).status === 400);
  check('anyone can read it (the forms need it)', (await call('GET', '/api/settings')).data?.testMode !== undefined);

  console.log('— OFF');
  check('Master turns it off', (await setMode(false)).data?.testMode === false);
  await settle();
  check('…the admin pages say so', (await call('GET', '/admin/registrations', undefined, master)).text.includes('data-on="false"'));
  const live = await call('GET', `/api/register/check?email=${encodeURIComponent(`qa.off${tag}@qa.test`)}`);
  check('a test address is refused while typing', live.data?.email?.ok === false && /testing mode/.test(live.data.email.message), live.data);
  check('…and when asking for the confirmation link', (await call('POST', '/api/register/email-check', { email: `qa.off${tag}@qa.test` })).status === 400);
  const blank = await call('POST', '/api/register', { username: `qa.off${tag}`, commEmail: `qa.off${tag}@qa.test`, password: `Qa-${randomBytes(9).toString('base64url')}`, profileType: 'employee' });
  check('registration needs every field', blank.status === 400 && /required/.test(blank.data?.error ?? ''), blank.data);
  const today = todayDateString();
  const ev = await call('POST', '/api/events', { name: `QA Mode ${tag}`, details: '', venue: '', accessFrom: today, accessTo: addDays(today, 1), gateOpens: '00:00', gateCloses: '23:59', linkExpiresAt: new Date(Date.now() + 86400_000).toISOString(), options: { requirePassword: false } }, master);
  const token = (await adminDb.collection('events').doc(ev.data.id).get()).get('linkToken');
  const kiosk = await call('POST', `/api/e/${token}/register`, { firstName: 'QA', lastName: 'Off', mobile: '98123 45633', email: `qa.k${tag}@qa.test`, purpose: 'x' });
  check('event sign-up refuses a test address', kiosk.status === 400 && /testing mode/.test(kiosk.data?.error ?? ''), kiosk.data);

  console.log('— ON');
  check('Master turns it on', (await setMode(true)).data?.testMode === true);
  await settle();
  check('…the admin pages say so', (await call('GET', '/admin/registrations', undefined, master)).text.includes('data-on="true"'));
  const email = `qa.on${tag}@qa.test`;
  check('a test address is accepted again', (await call('POST', '/api/register/email-check', { email })).status === 200);
  await sleep(800);
  const link = (await adminDb.collection('testOutbox').where('to', '==', email).get()).docs[0]?.get('link') as string;
  await fetch(link.replace(/^https?:\/\/[^/]+/, B));
  const reg = await call('POST', '/api/register', { username: `qa.on${tag}`, commEmail: email, password: `Qa-${randomBytes(9).toString('base64url')}`, profileType: 'employee' });
  check('registers with name, mobile and purpose left blank', reg.status === 201, reg.data);
  const p = reg.data?.personId ? (await adminDb.collection('people').doc(reg.data.personId).get()).data() : null;
  check('…stored as Test / User / Testing, no mobile, still PENDING', p?.firstName === 'Test' && p?.lastName === 'User' && p?.purpose === 'Testing' && p?.mobile === '' && p?.registrationStatus === 'PENDING', p && [p.firstName, p.lastName, p.purpose, p.mobile]);
  check('the Master can still approve them', reg.data?.personId ? (await call('POST', `/api/registrations/${reg.data.personId}/approve`, {}, master)).status === 200 : false);
  check('the kiosk accepts a test address again', (await call('POST', `/api/e/${token}/register`, { firstName: 'QA', lastName: 'On', mobile: '98123 45644', email: `qa.k${tag}@qa.test`, purpose: 'x' })).status === 201);

  const changes = (await adminDb.collection('auditLogs').where('action', '==', 'TEST_MODE_CHANGED').orderBy('timestamp', 'desc').limit(2).get()).docs.map((d) => d.get('details'));
  check('each switch is in the audit log', changes.length === 2 && changes[0].includes('ON') && changes[1].includes('OFF'), changes);
} finally {
  await setMode(true); // never leave it off behind the other tests
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
