import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { eventWindow, linkState, parseEventInput, parseSource, type EventRecord } from '@/lib/events';
import { MAX_BULK, parseDecisionBody } from '@/lib/decisions';
import { ACTIONS, parseAuditFilter } from '@/lib/logs';

test('event input: required name, real dates, HH:MM times, a parseable link expiry', () => {
  const ok = { name: ' Pitch Day ', details: 'x', venue: '', accessFrom: '2026-11-01', accessTo: '2026-11-02', gateOpens: '09:00', gateCloses: '18:00', linkExpiresAt: '2026-10-31T18:00:00+05:30' };
  const e = parseEventInput(ok, false);
  assert.equal(e.name, 'Pitch Day');
  assert.equal(e.linkExpiresAt.toDate().toISOString(), '2026-10-31T12:30:00.000Z');
  assert.throws(() => parseEventInput({ ...ok, name: '  ' }, false));
  assert.throws(() => parseEventInput({ ...ok, accessTo: '2026-02-30' }, false));
  assert.throws(() => parseEventInput({ ...ok, gateOpens: '9am' }, false));
  assert.throws(() => parseEventInput({ ...ok, linkExpiresAt: 'soon' }, false));
  assert.deepEqual(parseEventInput({ venue: 'Hall' }, true), { venue: 'Hall' }, 'edits keep only the given fields');
});

test('event link state and the access an approved registrant gets', () => {
  const at = (ms: number) => Timestamp.fromMillis(ms);
  const now = 1_800_000_000_000;
  assert.equal(linkState({ closedAt: null, linkExpiresAt: at(now + 1) }, now), 'OPEN');
  assert.equal(linkState({ closedAt: null, linkExpiresAt: at(now) }, now), 'EXPIRED');
  assert.equal(linkState({ closedAt: at(now - 5), linkExpiresAt: at(now + 1) }, now), 'CLOSED');
  const ev = { accessFrom: '2026-11-01', accessTo: '2026-11-03', gateOpens: '08:00', gateCloses: '20:00' } as EventRecord;
  assert.deepEqual(eventWindow(ev, '2026-10-20'), { startDate: '2026-11-01', endDate: '2026-11-03', weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '20:00' });
  assert.equal(eventWindow(ev, '2026-11-02').startDate, '2026-11-02', 'approved mid-event: starts today');
});

test('UTM source tags: short safe tags only, lower-cased', () => {
  assert.deepEqual(parseSource({ source: 'WhatsApp', medium: '<b>', campaign: 'x'.repeat(41) }), { source: 'whatsapp', medium: null, campaign: null });
  assert.deepEqual(parseSource(undefined), { source: null, medium: null, campaign: null });
});

test('bulk decisions: known kind and action, ids sane and capped', () => {
  const d = parseDecisionBody({ kind: 'registration', action: 'approve', ids: ['a1', 'a1', 'bad/id', 7], profileType: 'driver' });
  assert.deepEqual(d.ids, ['a1']);
  assert.equal(d.options.profileType, 'driver');
  assert.throws(() => parseDecisionBody({ kind: 'payments', action: 'approve', ids: ['a'] }));
  assert.throws(() => parseDecisionBody({ kind: 'request', action: 'delete', ids: ['a'] }));
  assert.throws(() => parseDecisionBody({ kind: 'request', action: 'reject', ids: [] }));
  assert.throws(() => parseDecisionBody({ kind: 'request', action: 'reject', ids: Array.from({ length: MAX_BULK + 1 }, (_, i) => `id${i}`) }));
});

test('audit filter: more than 30 ticked still parses (query switches to not-in)', () => {
  assert.ok(ACTIONS.length > 30);
  assert.equal(parseAuditFilter({ action: ACTIONS.slice(1) }).actions.length, ACTIONS.length - 1);
});
