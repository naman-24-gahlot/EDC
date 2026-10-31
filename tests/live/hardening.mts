// Security hardening of 2026-10-29: guards off the people/request lists, pass-link headers, the
// per-address daily cap on confirmation emails, the sign-in lock-out record, photo checking, and
// "delete my data" for no-password event guests. Creates a "QA" event and .test guests —
// checkpoint first, clean afterwards (npm run test:data).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/hardening.mts
import { readFileSync } from 'fs';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const call = async (method: string, path: string, body?: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }); const type = r.headers.get('content-type') ?? ''; return { status: r.status, headers: r.headers, data: type.includes('json') ? await r.json().catch(() => null) : null, text: type.includes('html') ? await r.text() : '' }; };
const login = async (u: string) => { const r = await fetch(`${B}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ identifier: u, password: creds[u] }) }); return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? ''; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]); // names are letters only
const [master, guard] = [await login('master'), await login('guard1')];

console.log('— guards and the lists');
check('guard: people list refused', (await call('GET', '/api/people', undefined, guard)).status === 403);
check('guard: request list refused', (await call('GET', '/api/requests', undefined, guard)).status === 403);
check('Master: people list still works', (await call('GET', '/api/people', undefined, master)).status === 200);

console.log('— pass-link headers');
for (const p of ['/v/abc', '/print/pass?t=abc', '/api/pass/pdf?t=abc']) {
  const h = (await call('GET', p)).headers;
  check(`${p.split('?')[0]}: not indexed, not cached, no referrer`, /noindex/.test(h.get('x-robots-tag') ?? '') && /no-store/.test(h.get('cache-control') ?? '') && h.get('referrer-policy') === 'no-referrer', [h.get('x-robots-tag'), h.get('cache-control'), h.get('referrer-policy')]);
}
check('other pages keep the normal referrer policy', (await call('GET', '/login')).headers.get('referrer-policy') === 'strict-origin-when-cross-origin');

console.log('— confirmation emails per address');
const addr = `qa.cap${tag}@qa.test`;
await adminDb.collection('emailChecks').doc(addr).set({ email: addr, requestedAt: Timestamp.fromMillis(Date.now() - 3_600_000), verifiedAt: null, expiresAt: null, sentDay: todayDateString(), sentCount: 4 });
let r = await call('POST', '/api/register/email-check', { email: addr });
check('5th link of the day is sent', r.status === 200, r.data);
check('…and counted', (await adminDb.collection('emailChecks').doc(addr).get()).get('sentCount') === 5);
await adminDb.collection('emailChecks').doc(addr).update({ requestedAt: Timestamp.fromMillis(Date.now() - 3_600_000) });
r = await call('POST', '/api/register/email-check', { email: addr });
check('6th is refused', r.status === 429 && /several links/.test(r.data?.error ?? ''), r.data);
await adminDb.collection('emailChecks').doc(addr).update({ sentDay: '2000-01-01' });
r = await call('POST', '/api/register/email-check', { email: addr });
check('a new day starts over', r.status === 200, r.data);

console.log('— sign-in lock-outs');
const who = `qa.nobody.${tag}`;
const tries: number[] = [];
for (let i = 0; i < 12; i++) tries.push((await call('POST', '/api/auth/session', { identifier: who, password: 'wrong-password' })).status);
check('10 wrong tries, then locked', tries.slice(0, 10).every((s) => s === 401) && tries.slice(10).every((s) => s === 429), tries);
await sleep(2000);
const locks = (await adminDb.collection('auditLogs').where('action', '==', 'SIGN_IN_LOCKED').orderBy('timestamp', 'desc').limit(20).get()).docs.filter((d) => String(d.get('details')).includes(who));
check('one audit entry when the lock-out starts (not one per try)', locks.length === 1 && locks[0].get('category') === 'security', locks.map((d) => d.get('details')));

console.log('— photos');
const bad = await call('PATCH', '/api/me/profile', { photoDataUrl: 'data:image/jpeg;base64,/9j/AAAA' }, master);
check('a file labelled JPEG that isn’t one is refused', bad.status === 400 && /not a real JPEG/.test(bad.data?.error ?? ''), bad.data);

console.log('— delete my data (no-password event guest)');
const today = todayDateString();
r = await call('POST', '/api/events', { name: `QA Delete ${tag}`, details: 'test', venue: '', accessFrom: today, accessTo: addDays(today, 1), gateOpens: '00:00', gateCloses: '23:59', linkExpiresAt: new Date(Date.now() + 86400_000).toISOString(), options: { requirePassword: false, autoApprove: true, emailPass: false, print: 'off' } }, master);
const eventId = r.data?.id ?? r.data?.eventId;
const ev = (await adminDb.collection('events').doc(eventId).get()).data()!;
const g = await call('POST', `/api/e/${ev.linkToken}/register`, { firstName: 'QA', lastName: `Delete${tag}`, mobile: '98123 45611', email: `qa.del${tag}@qa.test`, purpose: 'delete test' });
const { personId, passToken } = g.data ?? {};
check('guest registered with no password', g.status === 201 && !!passToken, g.data);
const page = await call('GET', `/v/${encodeURIComponent(passToken)}`);
check('their pass page offers “Delete my data”', page.text.includes('Delete my data'));
check('not on an account holder’s pass link', !(await call('GET', `/v/${encodeURIComponent((await import('@/lib/access/credential')).passTokenFor((await (await import('@/lib/hierarchy/authorize')).loadPerson((await adminDb.collection('people').where('username', '==', 'rahul').limit(1).get()).docs[0].id))!))}`)).text.includes('Delete my data'));
check('a tampered link can’t delete', (await call('POST', '/api/pass/delete', { token: passToken.slice(0, -4) + '0000', confirm: 'DELETE' })).status === 403);
check('must type DELETE', (await call('POST', '/api/pass/delete', { token: passToken, confirm: 'yes' })).status === 400);
r = await call('POST', '/api/pass/delete', { token: passToken, confirm: 'DELETE' });
check('deleted with their own link', r.status === 200, r.data);
check('…their record is gone', !(await adminDb.collection('people').doc(personId).get()).exists);
check('…and the link no longer works', (await call('GET', `/v/${encodeURIComponent(passToken)}`)).text.includes('isn’t an EDC pass'));
const del = (await adminDb.collection('auditLogs').where('targetPersonId', '==', personId).where('action', '==', 'ACCOUNT_DELETED').get()).docs[0];
check('audit: deleted by themselves', !!del && /deleted by themselves/.test(del.get('details')), del?.get('details'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
