import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { addDays, nowInIST, weekdayOf } from '@/lib/date';
import { effectiveStatus, parseWindowPatch, templateWindow, type Entitlement } from '@/lib/access/entitlements';
import { decideAccess } from '@/lib/access/evaluate';
import { accessCodeFor } from '@/lib/access/codes';

const at = (date: string, time: string) => ({ date, weekday: weekdayOf(date), time });
const MON = '2026-10-26';
const SAT = '2026-10-31';

function ent(over: Partial<Entitlement> = {}): Entitlement {
  const now = Timestamp.fromMillis(0);
  return {
    id: 'e1', personId: 'p1', profileTypeAtGrant: 'employee', startDate: '2026-10-01', endDate: null,
    weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', state: 'ACTIVE', sourceRequestId: null,
    approvedBy: 'm', approvedAt: now, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: now, ...over,
  };
}
const ok = { registrationStatus: 'APPROVED' as const, active: true };

test('IST clock: date, weekday and time, across IST midnight', () => {
  assert.deepEqual(nowInIST(new Date('2026-01-01T00:00:00Z')), { date: '2026-01-01', weekday: 4, time: '05:30' });
  assert.deepEqual(nowInIST(new Date('2026-03-01T18:45:00Z')), { date: '2026-03-02', weekday: 1, time: '00:15' });
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('gate rules: hours are start-inclusive, end-exclusive; weekdays enforced', () => {
  assert.equal(decideAccess(ok, ent(), at(MON, '09:00')).allowed, true);
  assert.equal(decideAccess(ok, ent(), at(MON, '16:59')).allowed, true);
  assert.equal(decideAccess(ok, ent(), at(MON, '08:59')).reason, 'Outside permitted hours');
  assert.equal(decideAccess(ok, ent(), at(MON, '17:00')).reason, 'Outside permitted hours');
  assert.equal(decideAccess(ok, ent(), at(SAT, '10:00')).reason, 'Outside permitted days');
});

test('gate rules: first failure wins, in the documented order', () => {
  assert.equal(decideAccess({ registrationStatus: 'PENDING', active: false }, ent(), at(MON, '10:00')).reason, 'Registration not approved');
  assert.equal(decideAccess({ registrationStatus: 'APPROVED', active: false }, ent(), at(MON, '10:00')).reason, 'Access revoked');
  assert.equal(decideAccess(ok, null, at(MON, '10:00')).reason, 'No active access');
  assert.equal(decideAccess(ok, ent({ state: 'SUPERSEDED' }), at(MON, '10:00')).reason, 'No active access');
  assert.equal(decideAccess(ok, ent({ state: 'REVOKED' }), at(MON, '10:00')).reason, 'Access revoked');
  assert.equal(decideAccess(ok, ent({ endDate: '2026-10-25' }), at(MON, '10:00')).reason, 'Access expired');
  assert.equal(decideAccess(ok, ent({ startDate: '2026-10-27' }), at(MON, '10:00')).reason, 'Access not yet active');
});

test('effective status is computed from dates, never stored', () => {
  assert.equal(effectiveStatus(ent({ endDate: '2026-10-26' }), '2026-10-26'), 'ACTIVE'); // end date inclusive
  assert.equal(effectiveStatus(ent({ endDate: '2026-10-26' }), '2026-10-27'), 'EXPIRED');
  assert.equal(effectiveStatus(ent({ startDate: '2026-11-01' }), '2026-10-31'), 'SCHEDULED');
});

test('templates count days inclusively', () => {
  assert.deepEqual(templateWindow('event_guest', '2026-10-21'), { startDate: '2026-10-21', endDate: '2026-10-22', weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' });
  assert.equal(templateWindow('incubee', '2026-10-21').endDate, addDays('2026-10-21', 89));
  assert.equal(templateWindow('employee', '2026-10-21').endDate, null);
});

test('window input: real dates only, valid weekdays/times, unknown keys dropped', () => {
  assert.deepEqual(parseWindowPatch({ startDate: '2028-02-29', weekdays: [5, 1, 1], startTime: '08:00', state: 'REVOKED', personId: 'x' }), { startDate: '2028-02-29', weekdays: [1, 5], startTime: '08:00' });
  for (const bad of [{ startDate: '2026-13-01' }, { startDate: '2026-02-30' }, { startDate: '2026-1-1' }, { weekdays: [] }, { weekdays: [7] }, { startTime: '24:00' }, { endTime: '9:00' }]) {
    assert.throws(() => parseWindowPatch(bad), /must|weekdays/, JSON.stringify(bad));
  }
});

test('access codes: prefix follows the profile type, digits stay', () => {
  assert.equal(accessCodeFor('employee', '25166'), 'EDC25166');
  assert.equal(accessCodeFor('relative', '25166'), 'REL25166');
  assert.equal(accessCodeFor(null, '25166'), null);
});
