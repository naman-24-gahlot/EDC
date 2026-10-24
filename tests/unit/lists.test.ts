import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, matches } from '@/lib/auth/passwordHashes';
import { categoryOf, parseCategory, parseSort, parseView, sortPeople } from '@/lib/people/browse';
import { ACTIONS, filterParams, parseAuditFilter, parseEntryFilter } from '@/lib/logs';
import type { PersonRecord } from '@/lib/hierarchy/authorize';

test('password fingerprints: match the same password only, never contain it', async () => {
  const h = await hashPassword('Correct-Horse-9');
  assert.ok(!h.includes('Correct-Horse-9'));
  assert.equal(await matches('Correct-Horse-9', h), true);
  assert.equal(await matches('correct-horse-9', h), false);
  assert.notEqual(await hashPassword('Correct-Horse-9'), h, 'salted: same password, different fingerprint');
  for (const junk of [null, undefined, '', 'plain', 'scrypt$', 'md5$a$b']) assert.equal(await matches('x', junk), false);
});

const person = (over: Partial<PersonRecord>): PersonRecord => ({
  personId: over.username ?? 'x', firstName: 'A', lastName: 'B', username: 'x', profileType: 'employee', systemRole: 'member',
  parentId: null, ancestorIds: [], registrationStatus: 'APPROVED', accessNumber: null, credentialVersion: 1, active: true, ...over,
});
const at = (ms: number) => ({ toMillis: () => ms });

test('people categories and sorting', () => {
  assert.equal(categoryOf(person({ systemRole: 'master' })), 'master');
  assert.equal(categoryOf(person({ systemRole: 'guard', profileType: null })), 'guard');
  assert.equal(categoryOf(person({ profileType: 'event_guest' })), 'guest');
  assert.equal(categoryOf(person({ profileType: 'bodyguard' })), 'dependant');
  const a = person({ username: 'a', firstName: 'Zed', lastEntryAt: at(5) });
  const b = person({ username: 'b', firstName: 'Amy' });
  const c = person({ username: 'c', firstName: 'Moe', lastEntryAt: at(9) });
  const names = (l: PersonRecord[]) => l.map((p) => p.username).join('');
  assert.equal(names(sortPeople([a, b, c], 'name', () => '')), 'bca');
  assert.equal(names(sortPeople([a, b, c], 'recent', () => '')), 'cab', 'never seen goes last');
  assert.equal(parseCategory('nope'), 'all');
  assert.equal(parseSort(undefined), 'name');
  assert.equal(parseView('cards'), 'cards');
});

test('log filters: only known values survive; all ticked = no filter', () => {
  const f = parseAuditFilter({ action: ['ENTRY_DENIED', 'BOGUS', 'ENTRY_DENIED'], person: 'abc/../x', from: '2026-10-21', to: '2026-13-45', order: 'asc' });
  assert.deepEqual(f.actions, ['ENTRY_DENIED']);
  assert.equal(f.person, null, 'path-like ids refused');
  assert.equal(f.from, '2026-10-21');
  assert.equal(f.to, null, 'impossible dates refused');
  assert.equal(f.order, 'asc');
  assert.deepEqual(parseAuditFilter({ action: ACTIONS.join(',') }).actions, []);
  assert.equal(parseEntryFilter({ result: 'MAYBE' }).result, null);
  assert.deepEqual(filterParams(parseAuditFilter({ action: 'PASSWORD_RESET,PASSWORD_CHANGED', order: 'desc' })), { action: 'PASSWORD_RESET,PASSWORD_CHANGED' });
});

test('mobile numbers: one rule for form and server', async () => {
  const { checkMobile } = await import('@/lib/phone');
  for (const [raw, stored] of [['98123 45670', '+919812345670'], ['+91-98123-45670', '+919812345670'], ['09812345670', '+919812345670'], ['919812345670', '+919812345670'], ['+14155550123', '+14155550123']]) {
    assert.equal(checkMobile(raw).value, stored, raw);
  }
  for (const bad of ['9876543210', '1234567890', '9999999999', '5123456789', '12345', '+0123456789', 'abc', '', '+11111111111']) {
    assert.equal(checkMobile(bad).ok, false, bad);
  }
});
