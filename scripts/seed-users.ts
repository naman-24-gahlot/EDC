/**
 * Seeds 4 demo accounts (2 admin, 1 employee, 1 guard) with role custom claims,
 * and mirrors each into Firestore `users/{uid}`. Safe to re-run — existing
 * accounts are updated in place (password rotated, claims reset) rather than
 * duplicated.
 *
 * Usage: npm run seed
 *
 * Self-contained on purpose: this runs outside the Next.js process (via tsx), so
 * it loads .env.local and initializes the Admin SDK itself rather than importing
 * lib/firebase/admin.ts.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

type Role = 'employee' | 'admin' | 'guard';

interface SeedAccount {
  email: string;
  displayName: string;
  role: Role;
}

const ACCOUNTS: SeedAccount[] = [
  { email: 'admin1@edc.demo', displayName: 'Admin One', role: 'admin' },
  { email: 'admin2@edc.demo', displayName: 'Admin Two', role: 'admin' },
  { email: 'employee1@edc.demo', displayName: 'Demo Employee', role: 'employee' },
  { email: 'guard1@edc.demo', displayName: 'Demo Guard', role: 'guard' },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

async function main() {
  const projectId = requireEnv('FIREBASE_ADMIN_PROJECT_ID');
  const clientEmail = requireEnv('FIREBASE_ADMIN_CLIENT_EMAIL');
  const privateKey = requireEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n');

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

  const auth = getAuth(app);
  const db = getFirestore(app);

  const results: Array<SeedAccount & { uid: string; password: string }> = [];

  for (const account of ACCOUNTS) {
    const password = generatePassword();
    let uid: string;

    try {
      const existing = await auth.getUserByEmail(account.email);
      uid = existing.uid;
      await auth.updateUser(uid, { password, displayName: account.displayName });
      console.log(`Updated existing user: ${account.email}`);
    } catch {
      const created = await auth.createUser({
        email: account.email,
        password,
        displayName: account.displayName,
        emailVerified: true,
      });
      uid = created.uid;
      console.log(`Created user: ${account.email}`);
    }

    await auth.setCustomUserClaims(uid, { role: account.role });

    await db
      .collection('users')
      .doc(uid)
      .set(
        {
          uid,
          email: account.email,
          displayName: account.displayName,
          role: account.role,
          active: true,
          createdAt: Timestamp.now(),
          createdBy: 'seed-script',
        },
        { merge: true }
      );

    results.push({ ...account, uid, password });
  }

  const outPath = path.join(process.cwd(), '.demo-credentials.local.txt');
  const contents =
    results
      .map((r) => `${r.role.toUpperCase()}\t${r.email}\t${r.password}\t(uid: ${r.uid})`)
      .join('\n') + '\n';
  writeFileSync(outPath, contents, 'utf8');

  console.log(`\nDone. ${results.length} accounts ready.`);
  console.log(`Credentials written to ${outPath} — gitignored, never commit this file.`);
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
