// SERVER-ONLY. The reusable pass credential — SECURITY_MODEL.md "Access credential".
//   token = `${personId}.${credentialVersion}.${hex HMAC-SHA256(personId.credentialVersion)}`
// Deterministic: the same person + version always yields the same token, so viewing or
// scanning a pass never changes it. Only a credentialVersion bump invalidates it.
if (typeof window !== 'undefined') {
  throw new Error('lib/qr-token.ts must never be imported into client code.');
}

import { createHmac, timingSafeEqual } from 'crypto';

function getSecret(): string {
  const secret = process.env.QR_TOKEN_SECRET;
  if (!secret) throw new Error('QR_TOKEN_SECRET is not set');
  return secret;
}

function computeSignature(personId: string, credentialVersion: number): string {
  return createHmac('sha256', getSecret()).update(`${personId}.${credentialVersion}`).digest('hex');
}

export function signPassToken(personId: string, credentialVersion: number): string {
  return `${personId}.${credentialVersion}.${computeSignature(personId, credentialVersion)}`;
}

export interface ParsedToken {
  personId: string;
  credentialVersion: number;
  signature: string;
}

const PERSON_ID_RE = /^[A-Za-z0-9]{1,128}$/;
const VERSION_RE = /^[1-9]\d{0,8}$/;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;

/** Shape check only — says nothing about authenticity. Null for anything malformed. */
export function parsePassToken(raw: string): ParsedToken | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 3) return null;
  const [personId, version, signature] = parts;
  if (!PERSON_ID_RE.test(personId) || !VERSION_RE.test(version) || !SIGNATURE_RE.test(signature)) return null;
  return { personId, credentialVersion: Number(version), signature };
}

/** Constant-time comparison — a plain === on a secret-derived value leaks timing info. */
export function verifyPassSignature(personId: string, credentialVersion: number, signature: string): boolean {
  const expected = Buffer.from(computeSignature(personId, credentialVersion), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
