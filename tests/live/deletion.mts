// Account deletion: who may delete whom, that every record goes, and that the audit log keeps the
// fact (details blanked) with its chain still intact. Creates and deletes .test people.
//   BASE=<url> npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/live/deletion.mts
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { sealAll, verifyChain } from '@/lib/auditChain';

const B = process.env.BASE ?? 'http://localhost:3000';
let fails = 0;
const check = (l: string, ok: boolean, d?: unknown) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d === undefined ? '' : `  → ${JSON.stringify(d)}`}`); };
const creds = Object.fromEntries(readFileSync('.demo-credentials.local.txt', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/)).map(([, , u, , pw]) => [u, pw]));
const call = async (method: string, path: string, body: unknown, cookie = '') => { const r = await fetch(`${B}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: B }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('session=')) ?? '' }; };
const login = async (u: string, pw = creds[u]) => (await call('POST', '/api/auth/session', { identifier: u, password: pw })).cookie;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (col: string, field: string, value: string) => (await adminDb.collection(col).where(field, '==', value).count().get()).data().count;

const [master, rahul, neha, guard] = [await login('master'), await login('rahul'), await login('neha'), await login('guard1')];

async function makePerson(tag: string) {
  const u = `qa.del${tag}`;
  await call('POST', '/api/register/email-check', { email: `${u}@qa.test` });
  await sleep(800);
  const link = (await adminDb.collection('testOutbox').where('to', '==', `${u}@qa.test`).get()).docs[0]?.data().link as string;
  await fetch(link.replace(/^https?:\/\/[^/]+/, B));
  const pw = `Qa-${randomBytes(9).toString('base64url')}`;
  const r = await call('POST', '/api/register', { firstName: 'QA', lastName: `Del${tag}`, username: u, commEmail: `${u}@qa.test`, backupEmail: `${u}.b@qa.test`, mobile: '9812345670', password: pw, purpose: 'deletion test', profileType: 'incubee' });
  await call('POST', `/api/registrations/${r.data.personId}/approve`, {}, master);
  return { id: r.data.personId as string, u, pw };
}

// ——— self-deletion
const tag = Date.now().toString(36);
const a = await makePerson(tag);
const me = await login(a.u, a.pw);
const code = `INC${(await adminDb.collection('people').doc(a.id).get()).get('accessNumber')}`;
await call('POST', '/api/guard/verify', { code, direction: 'IN' }, guard);
await call('POST', '/api/requests', { purpose: 'more time' }, me);
await sleep(1500);
check('setup: they have gate records, entitlements and audit entries', (await count('entryEvents', 'personId', a.id)) > 0 && (await count('entitlements', 'personId', a.id)) > 0 && (await count('auditLogs', 'targetPersonId', a.id)) > 0);

check('without typing DELETE → refused', (await call('DELETE', '/api/me/account', { password: a.pw }, me)).status === 400);
check('wrong password → refused', (await call('DELETE', '/api/me/account', { password: 'not-it-123', confirm: 'DELETE' }, me)).status === 403);
check('not signed in → refused', (await call('DELETE', '/api/me/account', { password: a.pw, confirm: 'DELETE' })).status === 401);
const r = await call('DELETE', '/api/me/account', { password: a.pw, confirm: 'DELETE' }, me);
check('deletes their own account', r.status === 200, r.data);
check('profile gone', !(await adminDb.collection('people').doc(a.id).get()).exists);
check('sign-in account gone', await adminAuth.getUser(a.id).then(() => false, () => true));
for (const [col, field] of [['identifiers', 'personId'], ['accessNumbers', 'personId'], ['entitlements', 'personId'], ['accessRequests', 'personId'], ['entryEvents', 'personId'], ['emailLog', 'personId'], ['testOutbox', 'personId']] as const) {
  check(`no ${col} left`, (await count(col, field, a.id)) === 0);
}
check('no emails left for their addresses', (await count('testOutbox', 'to', `${a.u}@qa.test`)) + (await count('testOutbox', 'to', `${a.u}.b@qa.test`)) + (await count('emailLog', 'to', `${a.u}.b@qa.test`)) === 0);
check('password fingerprints gone', !(await adminDb.collection('passwordHashes').doc(a.id).get()).exists);
const entries = (await adminDb.collection('auditLogs').where('targetPersonId', '==', a.id).get()).docs.map((d) => d.data());
check('audit keeps one ACCOUNT_DELETED entry', entries.filter((e) => e.action === 'ACCOUNT_DELETED').length === 1);
check('…and every other entry about them is blanked', entries.filter((e) => e.action !== 'ACCOUNT_DELETED').every((e) => e.redacted && !String(e.details ?? '').includes('Del')), entries.length);
const allText = (await adminDb.collection('auditLogs').select('details', 'subjectId').get()).docs.map((d) => `${d.get('details')} ${d.get('subjectId')}`).join(' ');
check('their username and emails appear nowhere in the audit log', !allText.includes(a.u));
check('they can’t sign in any more', (await call('POST', '/api/auth/session', { identifier: a.u, password: a.pw })).status === 401);
check('their old cookie is dead', (await call('GET', '/api/people', undefined, me)).status === 401);
check('the username is free again', !(await adminDb.collection('identifiers').doc(a.u).get()).exists);
await sealAll();
const chain = await verifyChain();
check('audit chain still intact (blanked entries accepted)', chain.broken === null && chain.redacted > 0, chain);

// ——— deleting others
const b = await makePerson(`${tag}b`);
check('Neha can’t delete someone else', (await call('DELETE', `/api/people/${b.id}`, { confirm: 'DELETE' }, neha)).status === 403);
check('Rahul (not their parent) can’t either', (await call('DELETE', `/api/people/${b.id}`, { confirm: 'DELETE' }, rahul)).status === 403);
check('a guard can’t', (await call('DELETE', `/api/people/${b.id}`, { confirm: 'DELETE' }, guard)).status === 403);
check('Master deletes them', (await call('DELETE', `/api/people/${b.id}`, { confirm: 'DELETE' }, master)).status === 200);
check('…gone', !(await adminDb.collection('people').doc(b.id).get()).exists && await adminAuth.getUser(b.id).then(() => false, () => true));

const v = await call('POST', '/api/visitors', { firstName: 'QAVisitor', lastName: 'Deletetest', mobile: '9812345670', purpose: 'deletion test' }, rahul);
check('Neha can’t delete Rahul’s visitor', (await call('DELETE', `/api/people/${v.data?.personId}`, { confirm: 'DELETE' }, neha)).status === 403);
check('Rahul deletes his own visitor pass', (await call('DELETE', `/api/people/${v.data?.personId}`, { confirm: 'DELETE' }, rahul)).status === 200);
check('someone with people under them can’t be deleted', (await call('DELETE', '/api/me/account', { password: creds.rahul, confirm: 'DELETE' }, rahul)).status === 409);
check('the only Master can’t delete themselves', (await call('DELETE', '/api/me/account', { password: creds.master, confirm: 'DELETE' }, master)).status === 409);
check('…and they still exist', (await adminDb.collection('people').where('username', 'in', ['rahul', 'master']).count().get()).data().count === 2);
await sealAll();
check('audit chain intact at the end', (await verifyChain()).broken === null);

console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(0);
