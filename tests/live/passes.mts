// Printable passes (who may print/download whose) and event link options incl. no-password kiosk
// sign-up. Creates a "QA" event and .test guests — checkpoint first, clean afterwards.
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/passes.mts
import { readFileSync } from 'fs';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';
import { passTokenFor } from '@/lib/access/credential';
import { loadPerson } from '@/lib/hierarchy/authorize';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const call = async (method: string, path: string, body: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }); const type = r.headers.get('content-type') ?? ''; return { status: r.status, type, data: type.includes('json') ? await r.json().catch(() => null) : null, bytes: type.includes('pdf') ? Buffer.from(await r.arrayBuffer()) : null, text: type.includes('html') ? await r.text() : '' }; };
const login = async (u: string) => { const r = await fetch(`${B}/api/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ identifier: u, password: creds[u] }) }); return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? ''; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idOf = async (u: string) => (await adminDb.collection('people').where('username', '==', u).limit(1).get()).docs[0].id;

const [master, rahul, neha, guard] = [await login('master'), await login('rahul'), await login('neha'), await login('guard1')];
const vikram = await idOf('vikram.singh'); // under Rahul
const rahulId = await idOf('rahul');

// ——— who may print / download whose pass
console.log('— printing permissions');
let r = await call('GET', '/api/pass/pdf?size=cr80', undefined, rahul);
check('own pass as PDF', r.status === 200 && r.type.includes('pdf') && r.bytes!.toString('latin1').startsWith('%PDF'), r.status);
check('a parent prints someone under them', (await call('GET', `/api/pass/pdf?person=${vikram}&size=cr80p`, undefined, rahul)).status === 200);
check('an unrelated employee can’t', (await call('GET', `/api/pass/pdf?person=${vikram}`, undefined, neha)).status === 403);
check('Master prints anyone', (await call('GET', `/api/pass/pdf?person=${rahulId}&size=a4`, undefined, master)).status === 200);
check('nobody signed in → refused', (await call('GET', `/api/pass/pdf?person=${rahulId}`, undefined)).status === 401);
check('a guard has no pass to print', (await call('GET', '/api/pass/pdf', undefined, guard)).status === 400);
const rahulToken = passTokenFor((await loadPerson(rahulId))!);
check('pass link works without signing in', (await call('GET', `/api/pass/pdf?t=${encodeURIComponent(rahulToken)}`, undefined)).status === 200);
check('a tampered pass link doesn’t', (await call('GET', `/api/pass/pdf?t=${encodeURIComponent(rahulToken.slice(0, -4) + '0000')}`, undefined)).status === 404);
for (const size of ['cr80', 'cr80p', 'cr100', 'badge', 'a6', 'a4']) {
  const p = await call('GET', `/api/pass/pdf?size=${size}`, undefined, rahul);
  check(`${size} PDF`, p.status === 200 && /\/MediaBox/.test(p.bytes!.toString('latin1')));
}
r = await call('GET', `/print/pass?person=${vikram}&size=badge`, undefined, rahul);
check('print page renders the card for a parent', r.status === 200 && r.text.includes('data-testid="pass-preview"') && r.text.includes('size: 101.6mm 76.2mm'));
check('print page refuses an unrelated employee', !(await call('GET', `/print/pass?person=${vikram}`, undefined, neha)).text.includes('pass-preview'));

// ——— event options
console.log('— event options');
const today = todayDateString();
const base = { name: `QA Kiosk ${Date.now().toString(36)}`, details: 'test', venue: '', accessFrom: today, accessTo: addDays(today, 1), gateOpens: '00:00', gateCloses: '23:59', linkExpiresAt: new Date(Date.now() + 86400_000).toISOString() };
check('kiosk mode with passwords is refused', (await call('POST', '/api/events', { ...base, options: { requirePassword: true, kiosk: true } }, master)).status === 400);
check('printing without on-the-spot approval is refused', (await call('POST', '/api/events', { ...base, options: { requirePassword: false, print: 'auto' } }, master)).status === 400);
check('only a Master creates events', (await call('POST', '/api/events', { ...base, options: {} }, rahul)).status === 403);
r = await call('POST', '/api/events', { ...base, options: { requirePassword: false, autoApprove: true, emailPass: true, print: 'auto', cardSize: 'cr80p', kiosk: true, kioskNext: 'unlock', kioskSeconds: 9999 } }, master);
check('Master creates a kiosk event', r.status === 201 || r.status === 200, r.data);
const eventId = r.data.id as string;
const ev = (await adminDb.collection('events').doc(eventId).get()).data()!;
const page = await call('GET', `/e/${ev.linkToken}`, undefined);
check('event link shows the quick form (no password field)', page.text.includes('data-testid="quick-register"') && !page.text.includes('type="password"'));

console.log('— quick sign-up');
const guest = { firstName: 'QA', lastName: 'Kiosk', mobile: '98123 45679', email: `qa.k${Date.now().toString(36)}@qa.test`, purpose: 'kiosk test' };
r = await call('POST', `/api/e/${ev.linkToken}/register`, guest);
check('registers with no password, approved on the spot', r.status === 201 && r.data?.status === 'APPROVED' && !!r.data?.passToken && /^GUE\d{5}$/.test(r.data?.accessCode), r.data);
check('…and the response says print automatically at the chosen size', r.data?.print === 'auto' && r.data?.cardSize === 'cr80p' && r.data?.kiosk === true);
check('…with the kiosk “next person” setting (timer capped at 300 s)', r.data?.kioskNext === 'unlock' && r.data?.kioskSeconds === 300, [r.data?.kioskNext, r.data?.kioskSeconds]);
const g = (await adminDb.collection('people').doc(r.data.personId).get()).data()!;
check('stored: no account, event guest, approved, event access only', g.hasAccount === false && g.profileType === 'event_guest' && g.registrationStatus === 'APPROVED' && g.eventId === eventId);
const ent = (await adminDb.collection('entitlements').where('personId', '==', r.data.personId).get()).docs[0]?.data();
check('access = the event’s days and hours', ent?.startDate === today && ent?.endDate === addDays(today, 1) && ent?.startTime === '00:00');
check('no password stored anywhere', !(await adminDb.collection('passwordHashes').doc(r.data.personId).get()).exists);
check('the gate lets them in by code', (await call('POST', '/api/guard/verify', { code: r.data.accessCode, direction: 'IN' }, guard)).data?.approved === true);
check('their pass prints from the link', (await call('GET', `/api/pass/pdf?t=${encodeURIComponent(r.data.passToken)}&size=cr80p`, undefined)).status === 200);
const kioskPage = await call('GET', `/print/pass?t=${encodeURIComponent(r.data.passToken)}&size=cr80p&next=${encodeURIComponent(`/e/${ev.linkToken}`)}&nm=unlock&ns=5`, undefined);
check('kiosk print page: no size picker, no PDF download', kioskPage.status === 200 && kioskPage.text.includes('data-testid="pass-preview"') && !kioskPage.text.includes('href="/api/pass/pdf') && !kioskPage.text.includes('aria-label="Card size"') && kioskPage.text.includes('data-testid="next-person"'));
// A foreign "next" is ignored: no Next-person button that could send the kiosk elsewhere.
check('“next” only goes back to an event link (no open redirect)', !(await call('GET', `/print/pass?t=${encodeURIComponent(r.data.passToken)}&next=${encodeURIComponent('https://evil.example')}`, undefined)).text.includes('data-testid="next-person"'));
check('the pass link page opens', (await call('GET', `/v/${encodeURIComponent(r.data.passToken)}`, undefined)).text.includes('EDC EVENT PASS'));
await sleep(3000);
const mail = (await adminDb.collection('testOutbox').where('to', '==', guest.email).get()).docs.map((d) => d.data());
check('pass emailed with the PDF attached', mail.some((m) => m.kind === 'EVENT_PASS' && (m.attachments ?? []).includes('edc-pass.pdf')));
check('same mobile again → refused', (await call('POST', `/api/e/${ev.linkToken}/register`, guest)).status === 409);
check('their type can’t be switched to one needing an account', (await call('POST', `/api/people/${r.data.personId}/profile-type`, { profileType: 'employee' }, master)).status === 400);
check('bad mobile refused', (await call('POST', `/api/e/${ev.linkToken}/register`, { ...guest, mobile: '12345' })).status === 400);

// Not on the spot: waits for a Master, who then approves; the pass goes out by email.
check('Master switches the event to "wait for approval"', (await call('PATCH', `/api/events/${eventId}`, { options: { requirePassword: false, autoApprove: false, emailPass: true, print: 'off', cardSize: 'cr80', kiosk: true } }, master)).status === 200);
const g2 = { ...guest, mobile: '98123 45678', email: `qa.w${Date.now().toString(36)}@qa.test` };
r = await call('POST', `/api/e/${ev.linkToken}/register`, g2);
check('registers and waits (no pass yet)', r.status === 201 && r.data?.status === 'PENDING' && r.data?.passToken === null, r.data);
check('Master approves', (await call('POST', `/api/registrations/${r.data.personId}/approve`, {}, master)).status === 200);
await sleep(3000);
check('…and the pass is emailed then', (await adminDb.collection('testOutbox').where('to', '==', g2.email).where('kind', '==', 'EVENT_PASS').get()).size === 1);
check('an event needing passwords refuses the quick route', await (async () => { await adminDb.collection('events').doc(eventId).update({ 'options.requirePassword': true, 'options.kiosk': false }); return (await call('POST', `/api/e/${ev.linkToken}/register`, { ...guest, mobile: '98123 45677' })).status === 400; })());

console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(0);
