/**
 * Seeds realistic demo data for presenting the prototype: several temporary
 * employees plus a handful of requests spanning PENDING/APPROVED/REJECTED/
 * CHECKED_IN so every screen has something to show during a walkthrough.
 *
 * Writes directly to Firestore (does not go through the real Route Handlers) —
 * this is for populating screens quickly, not a substitute for the real flow
 * already exercised live in Sessions 3-6.
 *
 * DEV-ONLY. Refuses to run when NODE_ENV=production.
 * Requires `npm run seed` to have been run first (needs admin1@edc.demo and
 * guard1@edc.demo to exist, to attribute the synthetic actions to real accounts).
 *
 * Usage: npm run seed:demo
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (process.env.NODE_ENV === 'production') {
  console.error(
    'Refusing to run: NODE_ENV=production. This script writes fake demo data and ' +
      'must never touch a production environment.'
  );
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Same IST day-boundary rule as lib/date.ts — duplicated here on purpose, since
// this script is deliberately self-contained (see scripts/seed-users.ts for why).
function dateStringDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

interface DemoEmployee {
  email: string;
  displayName: string;
}

const DEMO_EMPLOYEES: DemoEmployee[] = [
  { email: 'priya.sharma@edc.demo', displayName: 'Priya Sharma' },
  { email: 'rahul.verma@edc.demo', displayName: 'Rahul Verma' },
  { email: 'ananya.iyer@edc.demo', displayName: 'Ananya Iyer' },
  { email: 'karan.mehta@edc.demo', displayName: 'Karan Mehta' },
];

type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHECKED_IN';

async function main() {
  const privateKey = requireEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n');
  const projectId = requireEnv('FIREBASE_ADMIN_PROJECT_ID');
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail: requireEnv('FIREBASE_ADMIN_CLIENT_EMAIL'),
          privateKey,
        }),
      });

  console.log(`Seeding demo data into Firebase project: ${projectId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);

  const adminUser = await auth.getUserByEmail('admin1@edc.demo').catch(() => null);
  const guardUser = await auth.getUserByEmail('guard1@edc.demo').catch(() => null);
  if (!adminUser || !guardUser) {
    console.error('Run `npm run seed` first — this needs admin1@edc.demo and guard1@edc.demo to exist.');
    process.exit(1);
  }
  const adminUid = adminUser.uid;
  const guardUid = guardUser.uid;

  const employeeUids: Record<string, string> = {};
  const credentials: Array<{ email: string; displayName: string; password: string }> = [];

  for (const emp of DEMO_EMPLOYEES) {
    const password = generatePassword();
    credentials.push({ email: emp.email, displayName: emp.displayName, password });
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(emp.email);
      uid = existing.uid;
      await auth.updateUser(uid, { password, displayName: emp.displayName });
    } catch {
      const created = await auth.createUser({
        email: emp.email,
        password,
        displayName: emp.displayName,
        emailVerified: true,
      });
      uid = created.uid;
    }
    await auth.setCustomUserClaims(uid, { role: 'employee' });
    await db
      .collection('users')
      .doc(uid)
      .set(
        {
          uid,
          email: emp.email,
          displayName: emp.displayName,
          role: 'employee',
          active: true,
          createdAt: Timestamp.now(),
          createdBy: 'seed-demo-data',
        },
        { merge: true }
      );
    employeeUids[emp.email] = uid;
    console.log(`Employee ready: ${emp.displayName} <${emp.email}>`);
  }

  async function writeRequest(opts: {
    employeeEmail: string;
    displayName: string;
    date: string;
    status: RequestStatus;
    reviewNote?: string;
  }) {
    const employeeId = employeeUids[opts.employeeEmail];
    const requestId = `${employeeId}_${opts.date}`;
    const requestedAt = Timestamp.now();
    const reviewedAt = Timestamp.now();

    const data: Record<string, unknown> = {
      requestId,
      employeeId,
      employeeName: opts.displayName,
      date: opts.date,
      status: opts.status,
      requestedAt,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: opts.reviewNote ?? null,
      passNonce: null,
      passIssuedAt: null,
      checkedInBy: null,
      checkedInAt: null,
    };

    const auditEntries: Array<Record<string, unknown>> = [
      {
        action: 'REQUEST_CREATED',
        requestId,
        actorId: employeeId,
        actorRole: 'employee',
        targetEmployeeId: employeeId,
        timestamp: requestedAt,
        details: null,
      },
    ];

    if (opts.status === 'APPROVED' || opts.status === 'CHECKED_IN') {
      data.reviewedBy = adminUid;
      data.reviewedAt = reviewedAt;
      data.passNonce = randomBytes(16).toString('hex');
      data.passIssuedAt = reviewedAt;
      auditEntries.push({
        action: 'APPROVED',
        requestId,
        actorId: adminUid,
        actorRole: 'admin',
        targetEmployeeId: employeeId,
        timestamp: reviewedAt,
        details: null,
      });
    }
    if (opts.status === 'REJECTED') {
      data.reviewedBy = adminUid;
      data.reviewedAt = reviewedAt;
      auditEntries.push({
        action: 'REJECTED',
        requestId,
        actorId: adminUid,
        actorRole: 'admin',
        targetEmployeeId: employeeId,
        timestamp: reviewedAt,
        details: opts.reviewNote ?? null,
      });
    }
    if (opts.status === 'CHECKED_IN') {
      const checkedInAt = Timestamp.now();
      data.checkedInBy = guardUid;
      data.checkedInAt = checkedInAt;
      auditEntries.push({
        action: 'CHECKED_IN',
        requestId,
        actorId: guardUid,
        actorRole: 'guard',
        targetEmployeeId: employeeId,
        timestamp: checkedInAt,
        details: null,
      });
    }

    const batch = db.batch();
    batch.set(db.collection('requests').doc(requestId), data, { merge: true });
    for (const entry of auditEntries) {
      const ref = db.collection('auditLogs').doc();
      batch.set(ref, { ...entry, logId: ref.id });
    }
    await batch.commit();
    console.log(`Request seeded: ${opts.displayName} — ${opts.date} — ${opts.status}`);
  }

  const today = dateStringDaysAgo(0);

  await writeRequest({
    employeeEmail: 'priya.sharma@edc.demo',
    displayName: 'Priya Sharma',
    date: today,
    status: 'PENDING',
  });
  await writeRequest({
    employeeEmail: 'rahul.verma@edc.demo',
    displayName: 'Rahul Verma',
    date: today,
    status: 'APPROVED',
  });
  await writeRequest({
    employeeEmail: 'ananya.iyer@edc.demo',
    displayName: 'Ananya Iyer',
    date: today,
    status: 'REJECTED',
    reviewNote: 'ID card not submitted',
  });
  await writeRequest({
    employeeEmail: 'karan.mehta@edc.demo',
    displayName: 'Karan Mehta',
    date: today,
    status: 'CHECKED_IN',
  });

  // A little history depth so the History tab isn't only "today".
  await writeRequest({
    employeeEmail: 'priya.sharma@edc.demo',
    displayName: 'Priya Sharma',
    date: dateStringDaysAgo(1),
    status: 'CHECKED_IN',
  });
  await writeRequest({
    employeeEmail: 'karan.mehta@edc.demo',
    displayName: 'Karan Mehta',
    date: dateStringDaysAgo(2),
    status: 'REJECTED',
    reviewNote: 'Duplicate request',
  });

  const outPath = path.join(process.cwd(), '.demo-credentials-extra.local.txt');
  const contents =
    credentials
      .map((c) => `EMPLOYEE\t${c.email}\t${c.password}\t(${c.displayName})`)
      .join('\n') + '\n';
  writeFileSync(outPath, contents, 'utf8');

  console.log(`\nDemo data seeded. Credentials written to ${outPath} (gitignored).`);
}

main().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
