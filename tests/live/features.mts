// Visitors, stays, holidays, leave, emails, backup email, event report, audit chain — against a
// running instance with real accounts. Creates test records (QA… visitors, a qa.… person, .test
// emails) — checkpoint first, clean afterwards (npm run test:data). Takes ~2.5 min (holiday cache).
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/features.mts
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, nowInIST, todayDateString } from '@/lib/date';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const call = async (method: string, path: string, body: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? '' }; };
const post = (path: string, body: unknown, cookie = '') => call('POST', path, body, cookie);
const get = async (path: string, cookie = '') => { const r = await fetch(`${B}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' }); return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, '') }; };
const login = async (u: string) => (await post('/api/auth/session', { identifier: u, password: creds[u] })).cookie;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const people = adminDb.collection('people');

const [master, guard, rahul, neha] = [await login('master'), await login('guard1'), await login('rahul'), await login('neha')];
const tag = Date.now().toString(36);
const today = todayDateString();

// ——— Visitor passes
console.log('— visitor passes');
check('a guard can’t create visitor passes', (await post('/api/visitors', { firstName: 'QA', lastName: 'X', mobile: '9812345670', purpose: 'x' }, guard)).status === 403);
check('3-day visitor pass refused', (await post('/api/visitors', { firstName: 'QA', lastName: 'X', mobile: '9812345670', purpose: 'x', days: 3 }, rahul)).status === 400);
let r = await post('/api/visitors', { firstName: 'QAVisitor', lastName: 'Livetest', mobile: '9812345670', email: `qa.v${tag}@qa.test`, purpose: 'Live test', vvip: true, startTime: '00:00', endTime: '23:59' }, rahul);
check('Rahul creates a VVIP visitor pass', r.status === 201 && /^VIS\d{5}$/.test(r.data?.accessCode) && r.data?.passUrl?.includes('/v/'), r.data);
const vCode = r.data?.accessCode as string;
const vId = r.data?.personId as string;
const passPath = new URL(r.data?.passUrl).pathname;
const v = (await people.doc(vId).get()).data()!;
check('visitor: no account, under Rahul, host Rahul', v.hasAccount === false && v.parentId === v.hostId && v.ancestorIds.includes(v.hostId) && v.profileType === 'visitor');
let page = await get(passPath);
check('pass link opens without signing in, with the code', page.status === 200 && page.text.includes(vCode) && page.text.includes('VVIP'));
check('a tampered pass link is refused', !(await get(passPath.slice(0, -2) + '00')).text.includes(vCode));
await sleep(1500);
check('visitor pass emailed (test outbox)', !(await adminDb.collection('testOutbox').where('to', '==', `qa.v${tag}@qa.test`).get()).empty);
check('visitor username can’t sign in', (await post('/api/auth/session', { identifier: `visitor-${vCode.slice(3)}`, password: 'whatever-123' })).status === 401);
check('Master can’t reset a visitor’s password', (await post(`/api/people/${vId}/reset-password`, {}, master)).status === 400);
check('visitor type can’t be changed', (await post(`/api/people/${vId}/profile-type`, { profileType: 'employee' }, master)).status === 400);

r = await post('/api/guard/verify', { code: vCode, direction: 'IN' }, guard);
check('visitor let in, VVIP shown, host named', r.data?.approved === true && r.data?.person?.vvip === true && r.data?.notes?.some((n: string) => n.includes('Rahul')), r.data);
await sleep(2500);
check('host arrival email attempted (logged)', !(await adminDb.collection('emailLog').where('kind', '==', 'VISITOR_ARRIVED').where('personId', '==', v.hostId).get()).empty);
check('on campus now shows a Visitor group', (await get('/guard', guard)).text.includes('Visitor'));

// ——— Stays
console.log('— stays');
await post('/api/guard/verify', { code: vCode, direction: 'IN' }, guard);
await sleep(2500);
const quick = (await adminDb.collection('stayFlags').where('personId', '==', vId).get()).docs.map((d) => d.data());
check('a re-scan within the hour is not a missed exit', !quick.some((f) => f.kind === 'MISSED_EXIT'));
await people.doc(vId).update({ lastEntryAt: Timestamp.fromMillis(Date.now() - 2 * 3600_000) });
await post('/api/guard/verify', { code: vCode, direction: 'IN' }, guard);
await sleep(2500);
const missed = (await adminDb.collection('stayFlags').where('personId', '==', vId).get()).docs.map((d) => d.data());
check('entering again 2 h later without an exit → "no exit scan" flag', missed.some((f) => f.kind === 'MISSED_EXIT'));
// Pretend they came in yesterday and never left: loading "on campus now" flags it.
const yesterday = Timestamp.fromMillis(Date.now() - 26 * 3600_000);
await people.doc(vId).update({ lastEntryAt: yesterday, onCampus: true });
await get('/guard', guard);
await sleep(3000);
const flags = (await adminDb.collection('stayFlags').where('personId', '==', vId).get()).docs.map((d) => ({ id: d.id, ...d.data() } as { id: string; kind: string }));
const overnight = flags.find((f) => f.kind === 'OVERNIGHT');
check('still inside since yesterday → overnight flag', !!overnight, flags.map((f) => f.kind));
check('overnight alert emailed to the parent (logged)', !(await adminDb.collection('emailLog').where('kind', '==', 'STAY_ALERT').where('personId', '==', v.hostId).get()).empty);
check('Rahul sees stay alerts on /me', (await get('/me', rahul)).text.includes('Stay alerts'));
check('Neha can’t mark Rahul’s visitor’s alert', (await post(`/api/stays/${overnight?.id}/seen`, {}, neha)).status === 403);
check('Rahul marks it seen', (await post(`/api/stays/${overnight?.id}/seen`, {}, rahul)).status === 200);
// Late exit: entered today, gate closed 40 min ago.
const t = nowInIST();
const closed = `${String(Math.max(0, Number(t.time.slice(0, 2)) - 1)).padStart(2, '0')}:${t.time.slice(3, 5)}`;
if (t.time >= '01:30') {
  const ent = (await adminDb.collection('entitlements').where('personId', '==', vId).get()).docs[0];
  await people.doc(vId).update({ lastEntryAt: Timestamp.fromMillis(Date.now() - 90 * 60_000), onCampus: true });
  await ent.ref.update({ startTime: '00:00', endTime: closed });
  r = await post('/api/guard/verify', { code: vCode, direction: 'OUT' }, guard);
  await sleep(2500);
  const late = (await adminDb.collection('stayFlags').where('personId', '==', vId).get()).docs.map((d) => d.data()).find((f) => f.kind === 'LATE_EXIT');
  check('exit an hour after gate-closing → "left late" flag', r.data?.exit === true && !!late, late?.detail);
  const out = (await adminDb.collection('entryEvents').where('personId', '==', vId).get()).docs.map((d) => d.data()).find((e) => e.direction === 'OUT');
  check('exit records how long they stayed', typeof out?.stayMinutes === 'number' && out.stayMinutes >= 89, out?.stayMinutes);
  check('…and they’re no longer on campus', (await people.doc(vId).get()).data()!.onCampus === false);
  await ent.ref.update({ endTime: '23:59' });
} else console.log('SKIP  late exit (needs IST time after 01:30)');
check('stay alerts in the audit log', !(await adminDb.collection('auditLogs').where('targetPersonId', '==', vId).where('category', '==', 'stays').get()).empty);

// ——— Holidays (the gate caches a day's holiday for 60 s per server instance)
console.log('— holidays (waits ~2 min)');
check('only Master adds holidays', (await post('/api/holidays', { date: today, name: 'QA', appliesTo: ['visitor'] }, rahul)).status === 403);
check('past date refused', (await post('/api/holidays', { date: addDays(today, -1), name: 'QA' }, master)).status === 400);
const hadHoliday = (await adminDb.collection('holidays').doc(today).get()).exists;
if (!hadHoliday) {
  check('Master closes today for visitors', (await post('/api/holidays', { date: today, name: `QA holiday ${tag}`, appliesTo: ['visitor'] }, master)).status === 201);
  check('same date twice refused', (await post('/api/holidays', { date: today, name: 'again' }, master)).status === 409);
  await sleep(62_000);
  r = await post('/api/guard/verify', { code: vCode, direction: 'IN' }, guard);
  check('visitor refused: Campus holiday (with its name)', r.data?.approved === false && r.data?.reason === 'Campus holiday' && r.data?.notes?.some((n: string) => n.includes(tag)), r.data);
  check('holiday shows on the holidays page', (await get('/admin/holidays', master)).text.includes(`QA holiday ${tag}`));
  check('Master removes it', (await call('DELETE', `/api/holidays/${today}`, undefined, master)).status === 200);
  await sleep(62_000);
  r = await post('/api/guard/verify', { code: vCode, direction: 'IN' }, guard);
  check('…and the visitor gets in again', r.data?.approved === true, r.data?.reason);
} else console.log('SKIP  holiday gate check (a real holiday is set today)');

// ——— Leave
console.log('— leave');
const day = addDays(today, 40);
check('a visitor-less member (guard) can’t ask for leave', (await post('/api/leave', { startDate: day, reason: 'x' }, guard)).status === 403);
r = await post('/api/leave', { startDate: day, endDate: addDays(day, 1), reason: `QA leave ${tag}` }, rahul);
check('Rahul asks for 2 days of leave', r.status === 201, r.data);
const leaveId = r.data?.id as string;
check('overlapping leave refused', (await post('/api/leave', { startDate: addDays(day, 1), reason: 'again' }, rahul)).status === 409);
check('Rahul can’t approve his own leave', (await post(`/api/leave/${leaveId}/approve`, {}, rahul)).status === 403);
check('Neha can’t approve Rahul’s leave', (await post(`/api/leave/${leaveId}/approve`, {}, neha)).status === 403);
check('Master approves it', (await post(`/api/leave/${leaveId}/approve`, { note: 'Enjoy' }, master)).status === 200);
check('a decided leave can’t be decided again', (await post(`/api/leave/${leaveId}/reject`, {}, master)).status === 409);
check('Neha can’t cancel Rahul’s leave', (await post(`/api/leave/${leaveId}/cancel`, {}, neha)).status === 403);
check('Rahul cancels it', (await post(`/api/leave/${leaveId}/cancel`, {}, rahul)).status === 200);
check('leave decision emailed (logged)', !(await adminDb.collection('emailLog').where('kind', '==', 'LEAVE_DECIDED').get()).empty);

// ——— Approval email + backup email (a .test person, so no real inbox is ever emailed)
console.log('— approval email and backup email');
const u = `qa.f${tag}`;
await post('/api/register/email-check', { email: `${u}@qa.test` });
await sleep(800);
const link = (await adminDb.collection('testOutbox').where('to', '==', `${u}@qa.test`).get()).docs[0]?.data().link as string;
await fetch(link.replace(/^https?:\/\/[^/]+/, B));
const pw = `Qa-${randomBytes(9).toString('base64url')}`;
check('backup email same as the main one refused', (await post('/api/register', { firstName: 'QA', lastName: `F${tag}`, username: u, commEmail: `${u}@qa.test`, backupEmail: `${u}@qa.test`, mobile: '9812345670', password: pw, purpose: 'features test', profileType: 'incubee' })).status === 400);
r = await post('/api/register', { firstName: 'QA', lastName: `F${tag}`, username: u, commEmail: `${u}@qa.test`, backupEmail: `${u}.backup@qa.test`, mobile: '9812345670', password: pw, purpose: 'features test', profileType: 'incubee' });
const pid = r.data?.personId as string;
check('registers with a backup email', r.status === 201 && (await people.doc(pid).get()).data()?.backupEmail === `${u}.backup@qa.test`);
check('Master approves', (await post(`/api/registrations/${pid}/approve`, {}, master)).status === 200);
await sleep(2500);
const approval = (await adminDb.collection('testOutbox').where('to', '==', `${u}@qa.test`).where('kind', '==', 'REGISTRATION_APPROVED').get()).docs[0]?.data();
check('approval email has the profile, code and access', !!approval && approval.text.includes('Incubee') && /INC\d{5}/.test(approval.text) && approval.text.includes('/me/pass'));
check('…and a copy went to the backup email', !(await adminDb.collection('testOutbox').where('to', '==', `${u}.backup@qa.test`).where('kind', '==', 'REGISTRATION_APPROVED').get()).empty);
check('Master can’t set someone else’s backup email', (await call('PATCH', `/api/people/${pid}`, { backupEmail: 'evil@qa.test' }, master)).status === 403);
const me = (await post('/api/auth/session', { identifier: u, password: pw })).cookie;
check('they can change their own', (await call('PATCH', '/api/me/profile', { backupEmail: `${u}.second@qa.test` }, me)).status === 200);
await post('/api/auth/forgot', { identifier: u });
await sleep(3000);
// Reset-link poisoning: a forged host header must not change where the emailed link points.
await fetch(`${B}/api/auth/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B, 'X-Forwarded-Host': 'evil.example' }, body: JSON.stringify({ identifier: u }) });
await sleep(3000);
const resetLinks = (await adminDb.collection('testOutbox').where('to', '==', `${u}@qa.test`).where('kind', '==', 'resetPassword').get()).docs.map((d) => String(d.data().link));
check('reset links never point at a forged host', resetLinks.length > 0 && resetLinks.every((l) => !l.includes('evil.example')), resetLinks.map((l) => new URL(l).host));
check('forgot password: a reset link goes to the backup email too', !(await adminDb.collection('testOutbox').where('to', '==', `${u}.second@qa.test`).where('kind', '==', 'PASSWORD_RESET_BACKUP').get()).empty);

// ——— Pages, event report, audit filter split, audit chain
console.log('— pages and audit chain');
for (const p of ['/admin/stays', '/admin/leave', '/admin/holidays', '/admin/visitors', '/admin/outbox']) check(`${p} opens for Master`, (await get(p, master)).status === 200);
check('…and not for Rahul', (await get('/admin/stays', rahul)).status !== 200);
const ev = (await adminDb.collection('events').limit(1).get()).docs[0];
if (ev) check('event page has the event report', (await get(`/admin/events/${ev.id}`, master)).text.includes('data-testid="event-report"'));
const groups = (await import('@/lib/audit')).ACTIONS;
check('audit filter with 31 ticked works (split queries)', (await get(`/admin/audit?action=${groups.slice(0, 31).join(',')}`, master)).status === 200);
await sleep(2000);
page = await get('/admin/audit?verify=1', master);
check('audit chain: integrity check passes', page.text.includes('data-testid="chain-ok"'), page.text.match(/Chain broken[^<]*/)?.[0]);

console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(0);
