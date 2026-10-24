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

// ---- confirm the email BEFORE registering
const u = `qa.s${tag}`; const email = `${u}@qa.test`; const pw1 = strong();
const MOBILE = '9812345670';
let r = await post('/api/register', { firstName: 'QA', lastName: 'Signup', username: u, commEmail: email, mobile: MOBILE, password: pw1, purpose: 'sign-up test', profileType: 'incubee' });
check('registration refused until the email is confirmed', r.status === 400 && /Confirm your email/.test(r.data?.error), r.data?.error);
check('form status: not confirmed yet', (await (await fetch(`${B}/api/register/email-check?email=${encodeURIComponent(email)}`)).json()).confirmed === false);
r = await post('/api/register/email-check', { email });
check('confirmation link sent', r.status === 200, r.data);
check('a second send straight away is refused politely', (await post('/api/register/email-check', { email })).status === 429);
check('can’t request a link for an already-registered email', (await post('/api/register/email-check', { email: 'rahul@gmail.com' })).status === 400);
let link = await outbox(email, 'confirmEmail');
check('link lands in the test outbox', !!link && link.includes('/register/confirm'));
let page = await get(pathOf(link!));
check('opening it confirms the email', page.text.includes('Email confirmed'));
check('form status flips to confirmed', (await (await fetch(`${B}/api/register/email-check?email=${encodeURIComponent(email)}`)).json()).confirmed === true);
check('a tampered link is refused', (await get(pathOf(link!).replace(/token=[^&]+/, 'token=nope'))).text.includes('didn’t work'));

// ---- phone and password rules (email confirmed, so only these can fail)
const reg = (password: string, mobile = MOBILE) => post('/api/register', { firstName: 'QA', lastName: 'Signup', username: u, commEmail: email, mobile, password, purpose: 'sign-up test', profileType: 'incubee' });
for (const [m, why] of [['9876543210', 'placeholder'], ['5123456789', 'starts with 5'], ['99999 99999', 'one digit repeated'], ['12345', 'too short'], ['+0123456789', 'bad country code']]) {
  r = await reg(pw1, m);
  check(`mobile refused: ${why}`, r.status === 400, r.data?.error);
}
r = await reg('password123');
check('common password refused', r.status === 400, r.data?.error);
r = await reg('correcthorsebatterystaple');
check('breached password refused', r.status === 400 && /breach/.test(r.data?.error), r.data?.error);
r = await reg(`${u}-pass`);
check('password containing the username refused', r.status === 400, r.data?.error);
r = await reg(pw1, '+91 98123 45670');
check('registration with confirmed email, valid mobile, good password', r.status === 201, r.data);
const id = r.data?.personId as string;
const saved = (await adminDb.collection('people').doc(id).get()).data()!;
check('account starts with the email confirmed', saved.emailVerified === true && (await adminAuth.getUser(id)).emailVerified);
check('mobile stored in one form (+91…)', saved.mobile === '+919812345670', saved.mobile);
check('the confirmation is used up', (await (await fetch(`${B}/api/register/email-check?email=${encodeURIComponent(email)}`)).json()).confirmed === false);

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
const u2 = `qa.n${tag}`;
await post('/api/register/email-check', { email: `${u2}@qa.test` });
await get(pathOf((await outbox(`${u2}@qa.test`, 'confirmEmail'))!));
r = await post('/api/register', { firstName: 'QA', lastName: 'Second', username: u2, commEmail: `${u2}@qa.test`, mobile: MOBILE, password: strong(), purpose: 'sign-up test', profileType: 'incubee' });
await post(`/api/registrations/${r.data.personId}/approve`, {}, master);
check('Master test outbox lists both', (await get('/admin/outbox', master)).text.includes(email));
check('outbox is Master-only', (await get('/admin/outbox')).status === 307);
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(0);
