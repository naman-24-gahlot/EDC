import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { decideAccess } from '@/lib/access/evaluate';
import type { Entitlement } from '@/lib/access/entitlements';
import { parseWindowPatch } from '@/lib/access/entitlements';
import { fingerprint } from '@/lib/auditChain';
import { ACTIONS, auditQuery, parseAuditFilter } from '@/lib/logs';
import { parseHolidayInput } from '@/lib/holidays';
import { parseLeaveInput } from '@/lib/leave';
import { parseVisitorInput } from '@/lib/visitors';
import { parseBackupEmail, parseProfilePatch } from '@/lib/people/profile';
import { addDays, todayDateString } from '@/lib/date';
import { isWellFormedJpeg } from '@/lib/people/create';

const today = todayDateString();
const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'e', personId: 'p', profileTypeAtGrant: 'employee', startDate: addDays(today, -1), endDate: null, weekdays: [0, 1, 2, 3, 4, 5, 6],
  startTime: '00:00', endTime: '23:59', state: 'ACTIVE', sourceRequestId: null, approvedBy: 'm', approvedAt: Timestamp.now(),
  revokedBy: null, revokedAt: null, revokeReason: null, createdAt: Timestamp.now(), ...over,
});
const now = { date: today, weekday: 1, time: '10:00' };

test('holidays close the gate only for the groups chosen', () => {
  const employee = { active: true, registrationStatus: 'APPROVED' as const, profileType: 'employee' as const };
  const guest = { ...employee, profileType: 'event_guest' as const };
  const holiday = { appliesTo: ['employee' as const] };
  assert.equal(decideAccess(employee, ent(), now, holiday).reason, 'Campus holiday');
  assert.equal(decideAccess(guest, ent(), now, holiday).allowed, true);
  assert.equal(decideAccess(employee, ent(), now, null).allowed, true);
  // Other refusals still win first: a revoked pass says so even on a holiday.
  assert.equal(decideAccess(employee, ent({ state: 'REVOKED' }), now, holiday).reason, 'Access revoked');
  assert.deepEqual(parseHolidayInput({ date: '2030-01-26', name: 'Republic Day' }).appliesTo, ['employee', 'incubee', 'driver', 'relative', 'bodyguard']);
  assert.throws(() => parseHolidayInput({ date: '2030-01-26', name: 'x', appliesTo: ['nope'] }), /at least one group/);
});

test('audit chain: any change to an entry changes its fingerprint', () => {
  const e = { action: 'ENTRY_APPROVED', category: 'gate', actorId: 'g', actorRole: 'guard', targetPersonId: 'p', subjectId: 's', eventId: null, timestamp: Timestamp.fromMillis(1_700_000_000_000), details: 'QR' };
  const h = fingerprint('genesis', 1, e);
  assert.equal(fingerprint('genesis', 1, { ...e }), h, 'deterministic');
  assert.notEqual(fingerprint('genesis', 1, { ...e, details: 'CODE' }), h, 'edited details');
  assert.notEqual(fingerprint('genesis', 2, e), h, 'renumbered');
  assert.notEqual(fingerprint('other', 1, e), h, 'relinked');
  assert.notEqual(fingerprint('genesis', 1, { ...e, sealed: true, seq: 1 }), fingerprint('genesis', 1, { ...e, targetPersonId: 'q' }));
});

test('audit filter: many ticked + many unticked becomes disjoint queries', () => {
  const picked = ACTIONS.slice(0, 31);
  const q = auditQuery(parseAuditFilter({ action: picked.join(',') }));
  assert.ok(ACTIONS.length - 31 > 10, 'this case needs more than 10 unticked');
  assert.ok(Array.isArray(q) && q.length === 2);
  assert.ok(!Array.isArray(auditQuery(parseAuditFilter({ action: ACTIONS.slice(0, 30).join(',') }))));
  assert.ok(!Array.isArray(auditQuery(parseAuditFilter({ action: ACTIONS.slice(0, ACTIONS.length - 3).join(',') }))));
});

test('visitor, leave and overnight inputs', () => {
  const v = parseVisitorInput({ firstName: 'Asha', lastName: 'Rao', mobile: '98123 45670', purpose: 'Meeting', days: 2, vvip: true });
  assert.equal(v.mobile, '+919812345670');
  assert.equal(v.startDate, today);
  assert.equal(v.vvip, true);
  assert.throws(() => parseVisitorInput({ firstName: 'A', lastName: 'B', mobile: '9812345670', purpose: 'x', days: 3 }), /1 or 2 days/);
  assert.throws(() => parseVisitorInput({ firstName: 'A', lastName: 'B', mobile: '9812345670', purpose: 'x', startDate: addDays(today, -1) }), /start between/);
  assert.throws(() => parseVisitorInput({ firstName: 'A', lastName: 'B', mobile: '9812345670', purpose: 'x', startTime: '18:00', endTime: '09:00' }), /start is before/);

  assert.deepEqual(parseLeaveInput({ startDate: today, reason: 'Wedding' }), { startDate: today, endDate: today, reason: 'Wedding' });
  assert.throws(() => parseLeaveInput({ startDate: addDays(today, -1), reason: 'x' }), /past/);
  assert.throws(() => parseLeaveInput({ startDate: today, endDate: addDays(today, 60), reason: 'x' }), /at most 60/);

  assert.equal(parseWindowPatch({ allowOvernight: true }).allowOvernight, true);
  assert.throws(() => parseWindowPatch({ allowOvernight: 'yes' }), /true or false/);
});

test('backup email: only the person can set it; empty clears it', () => {
  assert.equal(parseBackupEmail(''), null);
  assert.equal(parseBackupEmail(' Me@Example.COM '), 'me@example.com');
  assert.throws(() => parseBackupEmail('not-an-email'), /valid backup email/);
  assert.throws(() => parseProfilePatch({ backupEmail: 'a@b.co' }), /Only the person/);
  assert.equal(parseProfilePatch({ backupEmail: 'a@b.co' }, { self: true }).backupEmail, 'a@b.co');
});

test('photos must be one well-formed JPEG', () => {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const sof = seg(0xc0, [8, 0, 200, 0, 160, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]); // 160×200
  const sos = seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const jpeg = (parts: number[][]) => Buffer.from([0xff, 0xd8, ...parts.flat(), 0x12, 0x34, 0xff, 0xd9]);
  assert.ok(isWellFormedJpeg(jpeg([seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), sof, sos])));
  assert.ok(!isWellFormedJpeg(Buffer.concat([jpeg([sof, sos]), Buffer.from('<x>')])), 'data after the end');
  assert.ok(!isWellFormedJpeg(jpeg([sos])), 'no frame header');
  assert.ok(!isWellFormedJpeg(jpeg([seg(0xc0, [8, 0x20, 0, 0, 160, 1, 1, 0x11, 0]), sos])), 'over 4096 px');
  assert.ok(!isWellFormedJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 0xff, 0xd9])), 'segment longer than the file');
  assert.ok(!isWellFormedJpeg(Buffer.from('89504e470d0a1a0a', 'hex')), 'not a JPEG');
});
