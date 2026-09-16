/**
 * DESTRUCTIVE. Wipes every Firebase Auth user and every Firestore document in both the old
 * (users/requests/auditLogs) and new collections, then seeds the expansion model with the
 * spec's own hierarchy example (Master → Employee 1 / Employee 2 → their subordinates).
 *
 * Refuses to run under NODE_ENV=production, and refuses without an explicit flag:
 *
 *   npm run reset:seed -- --yes-i-mean-it
 *
 * Self-contained on purpose (see scripts/seed-users.ts for why): loads .env.local itself
 * and never imports from lib/. Constants here (prefixes, templates) are duplicated from the
 * docs deliberately; lib/ is the source of truth for the app.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { randomBytes, randomInt } from 'crypto';
import { writeFileSync } from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production.');
  process.exit(1);
}
if (!process.argv.includes('--yes-i-mean-it')) {
  console.error(
    'This script DELETES every Auth user and every Firestore document in the project.\n' +
      'Re-run with:  npm run reset:seed -- --yes-i-mean-it'
  );
  process.exit(1);
}

type ProfileType = 'employee' | 'incubee' | 'event_guest' | 'driver' | 'relative' | 'bodyguard';
type SystemRole = 'master' | 'guard' | 'member';

const PREFIX: Record<ProfileType, string> = {
  employee: 'EDC',
  incubee: 'INC',
  event_guest: 'GUE',
  driver: 'DRV',
  relative: 'REL',
  bodyguard: 'BDG',
};

const TEMPLATES: Record<
  ProfileType,
  { weekdays: number[]; startTime: string; endTime: string; durationDays: number | null }
> = {
  employee: { weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', durationDays: null },
  incubee: { weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', durationDays: 90 },
  event_guest: { weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00', durationDays: 2 },
  driver: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00', durationDays: 30 },
  relative: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00', durationDays: 30 },
  bodyguard: { weekdays: [1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00', durationDays: 30 },
};

const OLD_COLLECTIONS = ['users', 'requests'];
const NEW_COLLECTIONS = [
  'people',
  'identifiers',
  'accessNumbers',
  'entitlements',
  'accessRequests',
  'entryEvents',
  'auditLogs',
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function istDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function daysAgo(days: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - days * 86_400_000);
}

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

interface SeedPerson {
  key: string;
  firstName: string;
  lastName: string;
  username: string;
  commEmail: string;
  mobile: string;
  purpose: string;
  profileType: ProfileType | null;
  systemRole: SystemRole;
  parentKey: string | null;
  registrationStatus: 'PENDING' | 'APPROVED';
  fixedAccessNumber?: string;
}

// Spec's hierarchy example. Employee 1 is Rahul Sharma / EDC25166 to match the pass mockup.
const PEOPLE: SeedPerson[] = [
  { key: 'master', firstName: 'Master', lastName: 'Admin', username: 'master', commEmail: 'master@edc.demo', mobile: '9000000001', purpose: 'EDC head', profileType: 'employee', systemRole: 'master', parentKey: null, registrationStatus: 'APPROVED' },
  { key: 'guard', firstName: 'Gate', lastName: 'Guard', username: 'guard1', commEmail: 'guard1@edc.demo', mobile: '9000000002', purpose: 'Gate security', profileType: null, systemRole: 'guard', parentKey: null, registrationStatus: 'APPROVED' },
  { key: 'emp1', firstName: 'Rahul', lastName: 'Sharma', username: 'rahul', commEmail: 'rahul@gmail.com', mobile: '9000000011', purpose: 'Programme manager', profileType: 'employee', systemRole: 'member', parentKey: null, registrationStatus: 'APPROVED', fixedAccessNumber: '25166' },
  { key: 'emp2', firstName: 'Neha', lastName: 'Kapoor', username: 'neha', commEmail: 'neha.kapoor@gmail.com', mobile: '9000000012', purpose: 'Operations lead', profileType: 'employee', systemRole: 'member', parentKey: null, registrationStatus: 'APPROVED' },
  { key: 'inc1', firstName: 'Arjun', lastName: 'Mehta', username: 'arjun', commEmail: 'arjun.mehta@gmail.com', mobile: '9000000013', purpose: 'Incubated startup founder', profileType: 'incubee', systemRole: 'member', parentKey: null, registrationStatus: 'APPROVED' },
  { key: 'driverA', firstName: 'Suresh', lastName: 'Kumar', username: 'suresh.kumar', commEmail: 'suresh.kumar@gmail.com', mobile: '9000000021', purpose: 'Driver for Rahul Sharma', profileType: 'driver', systemRole: 'member', parentKey: 'emp1', registrationStatus: 'APPROVED' },
  { key: 'relativeA', firstName: 'Anita', lastName: 'Sharma', username: 'anita.sharma', commEmail: 'anita.sharma@gmail.com', mobile: '9000000022', purpose: 'Family visit', profileType: 'relative', systemRole: 'member', parentKey: 'emp1', registrationStatus: 'APPROVED' },
  { key: 'bodyguardA', firstName: 'Vikram', lastName: 'Singh', username: 'vikram.singh', commEmail: 'vikram.singh@gmail.com', mobile: '9000000023', purpose: 'Personal security', profileType: 'bodyguard', systemRole: 'member', parentKey: 'emp1', registrationStatus: 'APPROVED' },
  { key: 'guestA', firstName: 'Priya', lastName: 'Nair', username: 'priya.nair', commEmail: 'priya.nair@gmail.com', mobile: '9000000024', purpose: 'Demo day speaker', profileType: 'event_guest', systemRole: 'member', parentKey: 'emp1', registrationStatus: 'APPROVED' },
  { key: 'driverB', firstName: 'Ramesh', lastName: 'Yadav', username: 'ramesh.yadav', commEmail: 'ramesh.yadav@gmail.com', mobile: '9000000031', purpose: 'Driver for Neha Kapoor', profileType: 'driver', systemRole: 'member', parentKey: 'emp2', registrationStatus: 'APPROVED' },
  { key: 'guestB', firstName: 'Karan', lastName: 'Mehta', username: 'karan.mehta', commEmail: 'karan.mehta@gmail.com', mobile: '9000000032', purpose: 'Investor meeting', profileType: 'event_guest', systemRole: 'member', parentKey: 'emp2', registrationStatus: 'APPROVED' },
  { key: 'pending1', firstName: 'Meera', lastName: 'Joshi', username: 'meera.joshi', commEmail: 'meera.joshi@gmail.com', mobile: '9000000041', purpose: 'Joining incubation cohort', profileType: 'incubee', systemRole: 'member', parentKey: null, registrationStatus: 'PENDING' },
];

interface Created {
  personId: string;
  password: string;
  ancestorIds: string[];
  profileType: ProfileType | null;
  accessCode: string | null;
}

async function deleteAllAuthUsers(auth: ReturnType<typeof getAuth>) {
  let pageToken: string | undefined;
  let total = 0;
  do {
    const page = await auth.listUsers(1000, pageToken);
    if (page.users.length > 0) {
      await auth.deleteUsers(page.users.map((u) => u.uid));
      total += page.users.length;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`Deleted ${total} Auth user(s).`);
}

async function deleteAllCollections(db: Firestore) {
  for (const name of [...OLD_COLLECTIONS, ...NEW_COLLECTIONS]) {
    await db.recursiveDelete(db.collection(name));
    console.log(`Cleared collection: ${name}`);
  }
}

async function main() {
  const projectId = requireEnv('FIREBASE_ADMIN_PROJECT_ID');
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail: requireEnv('FIREBASE_ADMIN_CLIENT_EMAIL'),
          privateKey: requireEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n'),
        }),
      });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const edcDomain = process.env.EDC_EMAIL_DOMAIN?.trim() || null;

  console.log(`Project: ${projectId}`);
  console.log(`EDC email domain: ${edcDomain ?? '(unset — EDC identifiers will not be assigned)'}`);

  console.log('\n--- WIPE ---');
  await deleteAllAuthUsers(auth);
  await deleteAllCollections(db);

  console.log('\n--- SEED ---');
  const created = new Map<string, Created>();
  const usedNumbers = new Set<string>();
  const now = Timestamp.now();

  const audit = async (
    action: string,
    actorId: string,
    actorRole: string,
    targetPersonId: string | null,
    subjectId: string | null,
    details: string | null,
    timestamp: Timestamp = now
  ) => {
    const ref = db.collection('auditLogs').doc();
    await ref.set({ action, actorId, actorRole, targetPersonId, subjectId, timestamp, details });
  };

  const nextAccessNumber = (fixed?: string): string => {
    if (fixed) {
      usedNumbers.add(fixed);
      return fixed;
    }
    for (;;) {
      const n = String(randomInt(10000, 100000));
      if (!usedNumbers.has(n)) {
        usedNumbers.add(n);
        return n;
      }
    }
  };

  for (const p of PEOPLE) {
    const password = generatePassword();
    const user = await auth.createUser({
      email: p.commEmail,
      password,
      displayName: `${p.firstName} ${p.lastName}`,
      emailVerified: true,
    });
    const personId = user.uid;
    await auth.setCustomUserClaims(personId, { systemRole: p.systemRole });

    const parent = p.parentKey ? created.get(p.parentKey) : null;
    if (p.parentKey && !parent) throw new Error(`Seed order error: parent ${p.parentKey} not created yet`);
    const ancestorIds = parent ? [...parent.ancestorIds, parent.personId] : [];

    const isApprovedMember = p.registrationStatus === 'APPROVED' && p.profileType !== null;
    const accessNumber = isApprovedMember ? nextAccessNumber(p.fixedAccessNumber) : null;
    const accessCode = accessNumber && p.profileType ? PREFIX[p.profileType] + accessNumber : null;
    const edcEmail = edcDomain && p.profileType ? `${p.username}@${edcDomain}` : null;
    const approver = parent ?? created.get('master') ?? null;
    const approverId = p.key === 'master' ? 'system' : (approver?.personId ?? 'system');

    const batch = db.batch();
    batch.set(db.collection('people').doc(personId), {
      personId,
      firstName: p.firstName,
      lastName: p.lastName,
      username: p.username,
      commEmail: p.commEmail,
      edcEmail,
      mobile: p.mobile,
      photoDataUrl: null,
      purpose: p.purpose,
      profileType: p.profileType,
      systemRole: p.systemRole,
      parentId: parent?.personId ?? null,
      ancestorIds,
      registrationStatus: p.registrationStatus,
      registrationDecision:
        p.registrationStatus === 'APPROVED' ? { by: approverId, at: now, note: null } : null,
      accessNumber,
      credentialVersion: 1,
      active: p.registrationStatus === 'APPROVED',
      createdAt: now,
      createdBy: parent ? parent.personId : 'self',
    });

    const identifiers = new Map<string, 'username' | 'commEmail' | 'edcEmail'>();
    identifiers.set(p.username.toLowerCase(), 'username');
    identifiers.set(p.commEmail.toLowerCase(), 'commEmail');
    if (edcEmail) identifiers.set(edcEmail.toLowerCase(), 'edcEmail');
    for (const [key, kind] of identifiers) {
      batch.create(db.collection('identifiers').doc(key), { personId, kind, createdAt: now });
    }
    if (accessNumber) {
      batch.create(db.collection('accessNumbers').doc(accessNumber), { personId, issuedAt: now });
    }
    await batch.commit();

    const actorRole = parent ? 'member' : p.key === 'master' ? 'system' : 'master';
    await audit('REGISTRATION_SUBMITTED', parent ? parent.personId : 'public', parent ? 'member' : 'public', personId, null, `profileType=${p.profileType ?? 'none'}`);
    if (p.registrationStatus === 'APPROVED') {
      await audit(p.systemRole === 'guard' ? 'GUARD_CREATED' : 'REGISTRATION_APPROVED', approverId, actorRole, personId, null, accessCode ? `accessCode=${accessCode}` : null);
      await audit('PROFILE_CREATED', approverId, actorRole, personId, null, null);
    }

    created.set(p.key, { personId, password, ancestorIds, profileType: p.profileType, accessCode });
    console.log(`Person: ${p.firstName} ${p.lastName} <${p.commEmail}> ${accessCode ?? ''} [${p.registrationStatus}]`);
  }

  const id = (key: string) => {
    const c = created.get(key);
    if (!c) throw new Error(`unknown seed key ${key}`);
    return c;
  };

  const grant = async (
    key: string,
    approvedByKey: string,
    overrides: Partial<{ startDate: string; endDate: string | null }> = {}
  ): Promise<string> => {
    const person = id(key);
    if (!person.profileType) throw new Error(`${key} has no profile type`);
    const t = TEMPLATES[person.profileType];
    const startDate = overrides.startDate ?? istDate(0);
    const endDate =
      overrides.endDate !== undefined
        ? overrides.endDate
        : t.durationDays === null
          ? null
          : istDate(t.durationDays);
    const ref = db.collection('entitlements').doc();
    await ref.set({
      personId: person.personId,
      profileTypeAtGrant: person.profileType,
      startDate,
      endDate,
      weekdays: t.weekdays,
      startTime: t.startTime,
      endTime: t.endTime,
      state: 'ACTIVE',
      sourceRequestId: null,
      approvedBy: id(approvedByKey).personId,
      approvedAt: now,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: now,
    });
    await audit('ENTITLEMENT_CREATED', id(approvedByKey).personId, approvedByKey === 'master' ? 'master' : 'member', person.personId, ref.id, `${startDate} → ${endDate ?? 'open'}`);
    console.log(`Entitlement: ${key} ${startDate} → ${endDate ?? 'open-ended'}`);
    return ref.id;
  };

  const request = async (key: string, requestedByKey: string, purpose: string, createdDaysAgo: number) => {
    const person = id(key);
    const createdAt = daysAgo(createdDaysAgo);
    const ref = db.collection('accessRequests').doc();
    await ref.set({
      personId: person.personId,
      requestedBy: id(requestedByKey).personId,
      purpose,
      requestedStartDate: istDate(0),
      requestedEndDate: null,
      status: 'PENDING',
      createdAt,
      actionableUntil: Timestamp.fromMillis(createdAt.toMillis() + 3 * 86_400_000),
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      resultingEntitlementId: null,
      expiredMarkedAt: null,
    });
    await audit('ACCESS_REQUEST_CREATED', id(requestedByKey).personId, 'member', person.personId, ref.id, purpose, createdAt);
    console.log(`Request: ${key} (${createdDaysAgo}d old, ${createdDaysAgo > 3 ? 'past actionable window' : 'actionable'})`);
  };

  const entry = async (key: string, entitlementId: string | null, method: 'QR' | 'CODE', result: 'APPROVED' | 'DENIED', reason: string | null, minutesAgo: number) => {
    const person = id(key);
    const timestamp = Timestamp.fromMillis(Date.now() - minutesAgo * 60_000);
    const ref = db.collection('entryEvents').doc();
    await ref.set({
      personId: person.personId,
      entitlementId,
      guardUid: id('guard').personId,
      method,
      result,
      reason,
      presentedCode: method === 'CODE' ? person.accessCode : null,
      timestamp,
    });
    await audit(result === 'APPROVED' ? 'ENTRY_APPROVED' : 'ENTRY_DENIED', id('guard').personId, 'guard', person.personId, ref.id, reason ?? method, timestamp);
  };

  // Entitlements per template
  await grant('master', 'master');
  const emp1Ent = await grant('emp1', 'master');
  await grant('emp2', 'master');
  await grant('inc1', 'master');
  await grant('driverA', 'emp1');
  await grant('relativeA', 'emp1');
  await grant('guestA', 'emp1');                       // 2-day event starting today
  await grant('driverB', 'emp2');
  // bodyguardA and guestB have NO entitlement — they have pending requests instead.

  // Requests: one live in each employee's queue (demo scoping), one stale (demo 3-day expiry)
  await request('bodyguardA', 'bodyguardA', 'Accompanying Rahul Sharma on campus', 1);
  await request('guestB', 'emp2', 'Investor meeting, 2 days', 1);
  await request('driverB', 'driverB', 'Renewal after current period', 4);

  // Entry events: reusable credential in action for Employee 1, one denial
  await entry('emp1', emp1Ent, 'QR', 'APPROVED', null, 240);
  await entry('emp1', emp1Ent, 'CODE', 'APPROVED', null, 60);
  await entry('guestB', null, 'CODE', 'DENIED', 'No active access', 30);

  // Credentials
  const lines = PEOPLE.map((p) => {
    const c = id(p.key);
    return [
      p.systemRole.toUpperCase().padEnd(6),
      (p.profileType ?? '-').padEnd(11),
      p.username.padEnd(14),
      p.commEmail.padEnd(28),
      c.password.padEnd(14),
      c.accessCode ?? '-',
      p.registrationStatus === 'PENDING' ? '(PENDING)' : '',
    ].join('  ');
  });
  const header = 'ROLE    PROFILE      USERNAME        COMM EMAIL                    PASSWORD        CODE';
  const outPath = path.join(process.cwd(), '.demo-credentials.local.txt');
  writeFileSync(outPath, [header, ...lines].join('\n') + '\n', 'utf8');

  console.log(`\nDone. ${PEOPLE.length} people seeded. Credentials → ${outPath} (gitignored).`);
  console.log('Login works with username, comm email, or EDC email (if a domain is configured) — same password.');
}

main().catch((err) => {
  console.error('Reset/seed failed:', err);
  process.exit(1);
});
