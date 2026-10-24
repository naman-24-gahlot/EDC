/**
 * LOCAL TESTING TOOL — sets a known password on one account and records it in
 * .demo-credentials.local.txt (git-ignored), so you always know your test accounts' passwords
 * without the app ever storing readable passwords.
 *
 *   npm run test:password -- <username> [new-password]
 *
 * Leave out the password to get a random one. Also clears a pending "must choose a new
 * password" state and signs the account out everywhere. Audited as PASSWORD_RESET by "system".
 */
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { accessCodeFor } from '@/lib/access/codes';
import { toPerson } from '@/lib/hierarchy/authorize';
import { hashPassword, writeHashes } from '@/lib/auth/passwordHashes';
import { audit } from '@/lib/audit';
import { sealAll } from '@/lib/auditChain';

const FILE = '.demo-credentials.local.txt';
const HEADER = 'ROLE    PROFILE      USERNAME        COMM EMAIL                    PASSWORD        CODE';

async function main() {
  const [identifier, given] = process.argv.slice(2);
  if (!identifier) throw new Error('Usage: npm run test:password -- <username> [new-password]');
  const password = given ?? randomBytes(9).toString('base64url');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  const personId = (await adminDb.collection('identifiers').doc(identifier.trim().toLowerCase()).get()).data()?.personId;
  if (typeof personId !== 'string') throw new Error(`No account with username/email "${identifier}".`);
  const person = toPerson(await adminDb.collection('people').doc(personId).get());
  if (!person) throw new Error('Account has no person record.');

  await adminAuth.updateUser(personId, { password });
  await writeHashes(personId, { current: await hashPassword(password), previous: null, oneTime: null });
  const { mustChangePassword: _pending, ...claims } = (await adminAuth.getUser(personId)).customClaims ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars -- dropping the flag
  await adminAuth.setCustomUserClaims(personId, claims);
  await adminAuth.revokeRefreshTokens(personId);
  await audit(null, { action: 'PASSWORD_RESET', actor: 'system', targetPersonId: personId, at: Timestamp.now(), details: 'set by the local test tool (scripts/set-test-password.ts)' });
  await sealAll();

  const row = [
    person.systemRole.toUpperCase().padEnd(8), (person.profileType ?? '-').padEnd(13), person.username.padEnd(16),
    String(person.commEmail ?? '').padEnd(30), password.padEnd(16), accessCodeFor(person.profileType, person.accessNumber) ?? '-',
  ].join('');
  const lines = existsSync(FILE) ? readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean) : [HEADER];
  const at = lines.findIndex((l, i) => i > 0 && l.trim().split(/\s+/)[2] === person.username);
  if (at > 0) lines[at] = row; else lines.push(row);
  writeFileSync(FILE, lines.join('\n') + '\n');
  console.log(`Password for @${person.username} set and saved in ${FILE}. They were signed out everywhere.`);
}

main().then(() => process.exit(0), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
