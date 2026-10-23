// Sign-up, email confirmation and forgot-password, end to end, using test addresses (…@qa.test)
// so no real email is sent: links are read from the test outbox. Creates test records — run
// `npm run test:data -- checkpoint` first and `… clean --yes` afterwards.
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/signup.mts
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase/admin';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const post = async (path: string, body: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? '' }; };
const get = async (path: string, cookie = '') => { const r = await fetch(`${B}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' }); return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, '') }; };
const check1 = async (q: string) => (await (await fetch(`${B}/api/register/check?${q}`)).json());
const strong = () => `Qa-${randomBytes(9).toString('base64url')}`;
const outbox = async (to: string, kind: string) => {
  for (let i = 0; i < 20; i++) { // sending runs after the reply; give it a moment
    const s = await adminDb.collection('testOutbox').where('to', '==', to).get();
    const m = s.docs.map((d) => d.data()).filter((x) => x.kind === kind).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];
    if (m) return m.link as string;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};
const pathOf = (link: string) => { const u = new URL(link); return `${u.pathname}${u.search}`; };
const tag = Date.now().toString(36);

// ---- live checks
check('username taken', (await check1('username=rahul')).username.ok === false);
check('username free', (await check1(`username=qa.free${tag}`)).username.ok === true);
check('username invalid', (await check1('username=A%20B')).username.ok === false);
check('email taken', (await check1(`email=${encodeURIComponent('rahul@gmail.com')}`)).email.ok === false);
check('email typo caught', /gmail\.com/.test((await check1('email=someone%40gmial.com')).email.message));
check('disposable email refused', (await check1('email=x%40mailinator.com')).email.ok === false);
check('domain that cannot receive mail', (await check1('email=x%40zz-not-a-real-domain-qa-9417.com')).email.ok === false);
check('real domain accepted', (await check1('email=someone.new%40gmail.com')).email.ok === true);
check('test address accepted', (await check1(`email=qa${tag}%40qa.test`)).email.ok === true);

// ---- registration rules
const reg = (u: string, password: string) => post('/api/register', { firstName: 'QA', lastName: 'Signup', username: u, commEmail: `${u}@qa.test`, mobile: '9876543210', password, purpose: 'sign-up test', profileType: 'incubee' });
let r = await reg(`qa.w${tag}`, 'password123');
check('common password refused', r.status === 400, r.data?.error);
r = await reg(`qa.w${tag}`, 'correcthorsebatterystaple');
check('breached password refused', r.status === 400 && /breach/.test(r.data?.error), r.data?.error);
r = await reg(`qa.w${tag}`, `qa.w${tag}-pass`);
check('password containing the username refused', r.status === 400, r.data?.error);
const u = `qa.s${tag}`; const email = `${u}@qa.test`; const pw1 = strong();
r = await reg(u, pw1);
check('registration with a good password', r.status === 201, r.data);
const id = r.data?.personId as string;

// ---- email confirmation via the outbox
let link = await outbox(email, 'verifyEmail');
check('confirmation email lands in the test outbox', !!link && link.includes('/auth/action?mode=verifyEmail'));
let page = await get(pathOf(link!));
check('opening the link confirms the email', page.text.includes('Email confirmed'));
check('…recorded on the person and the account', (await adminDb.collection('people').doc(id).get()).data()?.emailVerified === true && (await adminAuth.getUser(id)).emailVerified);
check('a used link says so', (await get(pathOf(link!))).text.includes('doesn’t work'));

// ---- forgot password
const master = (await post('/api/auth/session', { identifier: 'master', password: creds.master })).cookie;
await post(`/api/registrations/${id}/approve`, {}, master);
const t0 = Date.now(); const known = await post('/api/auth/forgot', { identifier: u }); const t1 = Date.now();
const unknown = await post('/api/auth/forgot', { identifier: `nobody-${tag}` }); const t2 = Date.now();
check('same answer for a real and an unknown account', known.status === 200 && JSON.stringify(known.data) === JSON.stringify(unknown.data));
check('…and similar timing (work happens after the reply)', Math.abs((t1 - t0) - (t2 - t1)) < 1500, [t1 - t0, t2 - t1]);
link = await outbox(email, 'resetPassword');
check('reset email lands in the test outbox', !!link);
page = await get(pathOf(link!));
check('reset link opens the form without using it up', page.text.includes('Set a new password') && page.text.includes('@qa.test'));
const code = new URL(link!).searchParams.get('oobCode');
r = await post('/api/auth/reset', { oobCode: code, newPassword: pw1 });
check('reset to the current password refused', r.status === 400, r.data?.error);
r = await post('/api/auth/reset', { oobCode: code, newPassword: 'correcthorsebatterystaple' });
check('reset to a breached password refused', r.status === 400, r.data?.error);
const pw2 = strong();
r = await post('/api/auth/reset', { oobCode: code, newPassword: pw2 });
check('reset with a new password', r.status === 200, r.data);
check('old password no longer works', (await post('/api/auth/session', { identifier: u, password: pw1 })).status === 401);
const signedIn = await post('/api/auth/session', { identifier: u, password: pw2 });
check('new password signs in', signedIn.status === 200);
check('the reset link can’t be used twice', (await post('/api/auth/reset', { oobCode: code, newPassword: strong() })).status === 400);
check('reset audited', (await adminDb.collection('auditLogs').where('targetPersonId', '==', id).get()).docs.some((d) => d.data().action === 'PASSWORD_CHANGED' && /email link/.test(d.data().details)));

// ---- My account banner, outbox page
const u2 = `qa.n${tag}`; r = await reg(u2, strong());
await post(`/api/registrations/${r.data.personId}/approve`, {}, master);
check('Master test outbox lists both', (await get('/admin/outbox', master)).text.includes(email));
check('outbox is Master-only', (await get('/admin/outbox')).status === 307);
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(0);
