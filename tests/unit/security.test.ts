import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePassToken, signPassToken, verifyPassSignature } from '@/lib/qr-token';
import { RateLimiter, RULES, bucketsFor } from '@/lib/rateLimit';
import { parseProfilePatch } from '@/lib/people/profile';
import { validatePhoto } from '@/lib/people/create';
import { parseCreateRequest } from '@/lib/access/requests';

test('pass token: deterministic, verifies, and any tampering fails', () => {
  const t = signPassToken('Abc123', 3);
  assert.equal(t, signPassToken('Abc123', 3));
  const p = parsePassToken(t)!;
  assert.equal(verifyPassSignature(p.personId, p.credentialVersion, p.signature), true);
  const flipped = p.signature.slice(0, -1) + (p.signature.endsWith('0') ? '1' : '0');
  assert.equal(verifyPassSignature(p.personId, p.credentialVersion, flipped), false);
  assert.equal(verifyPassSignature(p.personId, 4, p.signature), false, 'another version');
  assert.equal(verifyPassSignature('Other1', 3, p.signature), false, 'another person');
});

test('pass token: malformed input never reaches the HMAC', () => {
  const sig = 'a'.repeat(64);
  for (const bad of ['', 'a.b', 'a.b.c.d', `x.0.${sig}`, `x.1.${sig.toUpperCase()}`, `../x.1.${sig}`, `x.1e3.${sig}`, `x.1.${sig}0`]) {
    assert.equal(parsePassToken(bad), null, bad);
  }
});

test('rate limiter: allows the budget, refuses the next, resets after the window', () => {
  let now = 0;
  const rl = new RateLimiter(() => now);
  const rule = { name: 't', max: 3, windowMs: 1000 };
  assert.deepEqual([1, 2, 3, 4].map(() => rl.hit(rule, 'k').ok), [true, true, true, false]);
  assert.equal(rl.hit(rule, 'other').ok, true, 'buckets are per key');
  now = 1000;
  assert.equal(rl.hit(rule, 'k').ok, true, 'window reset');
});

test('rate limiter keys: per session when signed in, per IP otherwise, with an IP ceiling', () => {
  const signedIn = bucketsFor({ method: 'POST', pathname: '/api/requests', ip: '1.2.3.4', sessionKey: 'abc' });
  assert.deepEqual(signedIn.map((b) => [b.rule.name, b.key]), [[RULES.anyPerIp.name, '1.2.3.4'], [RULES.writePerSession.name, 's:abc']]);
  const login = bucketsFor({ method: 'POST', pathname: '/api/auth/session', ip: '1.2.3.4', sessionKey: null });
  assert.deepEqual(login.map((b) => b.rule.name), [RULES.anyPerIp.name, RULES.loginPerIp.name]);
  const gate = bucketsFor({ method: 'POST', pathname: '/api/guard/verify', ip: '1.2.3.4', sessionKey: 'g' });
  assert.equal(gate[1].rule, RULES.gatePerSession);
});

test('profile edits: only known fields, validated', () => {
  assert.deepEqual(parseProfilePatch({ firstName: ' Asha ', mobile: '+91 90000 12345', systemRole: 'master', username: 'x' }), { firstName: 'Asha', mobile: '+91 90000 12345' });
  for (const bad of [{}, { firstName: '' }, { firstName: '<script>' }, { mobile: '12' }, { purpose: 'x'.repeat(201) }, { photoDataUrl: 'data:image/png;base64,AAAA' }]) {
    assert.throws(() => parseProfilePatch(bad), Error, JSON.stringify(bad));
  }
});

test('photos: JPEG data URLs under 150KB only', () => {
  assert.equal(validatePhoto(null), null);
  assert.equal(validatePhoto('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
  assert.throws(() => validatePhoto('data:image/svg+xml;base64,AAAA'));
  assert.throws(() => validatePhoto('javascript:alert(1)'));
  assert.throws(() => validatePhoto(`data:image/jpeg;base64,${'A'.repeat(210_000)}`));
});

test('access requests: purpose required, dates real and ordered', () => {
  const actor = { personId: 'me', email: null, systemRole: 'member' as const };
  assert.equal(parseCreateRequest(actor, { purpose: 'x' }).personId, 'me');
  assert.throws(() => parseCreateRequest(actor, {}));
  assert.throws(() => parseCreateRequest(actor, { purpose: 'x', requestedStartDate: '2026-13-01' }));
  assert.throws(() => parseCreateRequest(actor, { purpose: 'x', requestedStartDate: '2026-10-22', requestedEndDate: '2026-10-21' }));
});
