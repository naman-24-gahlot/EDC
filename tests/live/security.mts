// Live, READ-ONLY security probe — safe to run against production at any time:
//   npm run test:live                                   (local dev server)
//   BASE=https://edc-gib-24.vercel.app npm run test:live (the live site)
// Needs the seeded accounts in .demo-credentials.local.txt and .env.local (for the Firestore
// REST check). Every request here is a sign-in or something that must be REFUSED, so it
// changes nothing. Prints statuses only, never passwords, tokens or cookies.
import { readFileSync } from 'fs';

const B = process.env.BASE ?? 'http://localhost:3000';
let failures = 0;
function check(label: string, ok: boolean, detail: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(detail)}`);
}

const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean)
  .map((l) => l.trim().split(/\s+/)).map(([, , u, email, pw]) => [u, { email, pw }]));
async function login(u: string) {
  const r = await fetch(`${B}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: u, password: creds[u].pw }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? '';
}
const req = (method: string, path: string, cookie = '', body?: unknown, extra: Record<string, string> = {}) =>
  fetch(`${B}${path}`, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });

console.log(`Probing ${B}`);

// 1. Security headers.
const h = (await req('GET', '/login')).headers;
check('anti-framing, nosniff, referrer and permissions headers', h.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(h.get('content-security-policy') ?? '') && h.get('x-content-type-options') === 'nosniff' && !!h.get('referrer-policy') && /camera=\(self\)/.test(h.get('permissions-policy') ?? ''), Object.fromEntries(['x-frame-options', 'x-content-type-options'].map((k) => [k, h.get(k)])));

// 2. CSRF: a foreign site can't sign a browser in or act with its cookie.
check('cross-site login refused', (await req('POST', '/api/auth/session', '', { identifier: 'rahul', password: 'x' }, { Origin: 'https://evil.example' })).status === 403, 403);
check('Sec-Fetch-Site: cross-site refused', (await req('POST', '/api/requests', '', { purpose: 'x' }, { 'Sec-Fetch-Site': 'cross-site' })).status === 403, 403);

// 3. Signed out: every protected API says 401, every protected page redirects to /login.
const apis: [string, string][] = [
  ['GET', '/api/people'], ['POST', '/api/people'], ['GET', '/api/people/x'], ['PATCH', '/api/people/x'], ['POST', '/api/people/x/promote'],
  ['POST', '/api/people/x/reset-password'], ['POST', '/api/people/x/profile-type'], ['GET', '/api/people/x/entitlements'],
  ['GET', '/api/requests'], ['POST', '/api/requests'], ['POST', '/api/requests/x/approve'], ['POST', '/api/registrations/x/approve'],
  ['POST', '/api/guard/verify'], ['PATCH', '/api/me/profile'], ['POST', '/api/me/password'], ['DELETE', '/api/me/sessions'],
  ['POST', '/api/me/credential/reissue'], ['POST', '/api/guards'], ['GET', '/api/admin/export/audit'], ['PATCH', '/api/entitlements/x'],
];
const signedOut = await Promise.all(apis.map(async ([m, p]) => [`${m} ${p}`, (await req(m, p, '', m === 'GET' ? undefined : {})).status] as const));
check(`signed out: all ${apis.length} protected APIs → 401`, signedOut.every(([, s]) => s === 401), signedOut.filter(([, s]) => s !== 401));
const pages = ['/me', '/me/pass', '/admin', '/admin/people', '/admin/audit', '/guard'];
const pageStatus = await Promise.all(pages.map(async (p) => { const r = await req('GET', p); return [p, r.status, r.headers.get('location')] as const; }));
check('signed out: protected pages → redirect to /login', pageStatus.every(([, s, l]) => s === 307 && /\/login$/.test(l ?? '')), pageStatus.filter(([, s]) => s !== 307));

// 4. Wrong role: a member and a guard are refused every Master action (bodies are empty,
//    so even a wrongly-allowed call couldn't change anything).
// The member account to probe with: MEMBER=neha if rahul is mid password reset, for example.
const MEMBER = process.env.MEMBER ?? 'rahul';
const rahul = await login(MEMBER);
const guard = await login('guard1');
check('member + guard sessions obtained', !!rahul && !!guard, { [MEMBER]: !!rahul, guard: !!guard });
for (const [who, cookie] of [[`${MEMBER} (member)`, rahul], ['guard1 (guard)', guard]] as const) {
  const masterOnly = [
    await req('POST', '/api/guards', cookie, {}), await req('GET', '/api/admin/export/audit', cookie), await req('GET', '/api/admin/export/entries', cookie),
    await req('POST', '/api/people/x/promote', cookie, {}), await req('POST', '/api/people/x/reset-password', cookie, {}), await req('POST', '/api/people/x/profile-type', cookie, { profileType: 'driver' }),
  ].map((r) => r.status);
  check(`${who}: every Master-only API refused`, masterOnly.every((s) => s === 403), masterOnly);
}
check('member: gate API refused', (await req('POST', '/api/guard/verify', rahul, { code: 'EDC25166' })).status === 403, 403);

// 5. The layout-skip bypass (fixed): replay a real client navigation into /admin as a member,
//    a guard and anonymously — no admin data may come back.
const tree = encodeURIComponent('["",{"children":["admin",{"children":["__PAGE__",{},null,null,4096]},null,null,4096]},null,null,4112]');
const marker = /REGISTRATION_SUBMITTED|ENTITLEMENT_CREATED|@neha|ramesh\.yadav|karan\.mehta|Gate Guard/;
for (const [who, cookie] of [['member', rahul], ['guard', guard], ['anonymous', '']] as const) {
  const leaks: string[] = [];
  for (const target of ['/admin', '/admin/audit', '/admin/people', '/admin/entries', '/admin/hierarchy', '/admin/registrations', '/admin/guards']) {
    const headers = { RSC: '1', 'Next-Router-State-Tree': tree, 'Next-Url': '/admin', ...(cookie ? { Cookie: cookie } : {}) };
    let r = await fetch(`${B}${target}`, { redirect: 'manual', headers });
    const loc = r.headers.get('location');
    if (r.status === 307 && loc?.includes('_rsc=')) r = await fetch(new URL(loc, B), { redirect: 'manual', headers });
    if (marker.test(await r.text())) leaks.push(target);
  }
  check(`${who}: crafted navigation requests reveal no admin data`, leaks.length === 0, leaks);
}

// 6. Out of hierarchy: Rahul can't read Neha's people.
const people = await (await req('GET', '/api/people', rahul)).json();
check("member's listing holds only their own descendants", Array.isArray(people.people) && !people.people.some((p: { username: string }) => (MEMBER === 'neha' ? ['rahul'] : ['ramesh.yadav', 'karan.mehta', 'neha']).includes(p.username)), people.people?.map((p: { username: string }) => p.username));

// 7. Direct Firestore access with a real ID token is denied.
const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const project = process.env.FIREBASE_ADMIN_PROJECT_ID;
if (key && project) {
  const idToken = (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: creds[MEMBER].email, password: creds[MEMBER].pw, returnSecureToken: true }) })).json()).idToken;
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const statuses = await Promise.all(['people', 'identifiers', 'entitlements', 'auditLogs'].map(async (c) => (await fetch(`${base}/${c}?pageSize=1`, { headers: { Authorization: `Bearer ${idToken}` } })).status));
  check('Firestore REST with a member ID token: every read denied', statuses.every((s) => s === 403), statuses);
} else {
  console.log('SKIP  Firestore REST check (run with .env.local to include it)');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
