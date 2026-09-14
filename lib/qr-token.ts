// SERVER-ONLY. See SECURITY_MODEL.md "QR pass token — design (Session 6)" for the
// full scheme. Deliberately shared between the employee pass view and the guard
// verification route — the token scheme is one design, not two independent copies.
if (typeof window !== 'undefined') {
  throw new Error('lib/qr-token.ts must never be imported into client code.');
}

import { createHmac, timingSafeEqual } from 'crypto';

function getSecret(): string {
  const secret = process.env.QR_TOKEN_SECRET;
  if (!secret) throw new Error('QR_TOKEN_SECRET is not set');
  return secret;
}

function computeSignature(requestId: string, nonce: string): string {
  return createHmac('sha256', getSecret()).update(`${requestId}.${nonce}`).digest('hex');
}

/** Deterministic — same requestId+nonce always produces the same token. */
export function signPassToken(requestId: string, nonce: string): string {
  return `${requestId}.${nonce}.${computeSignature(requestId, nonce)}`;
}

export interface ParsedToken {
  requestId: string;
  nonce: string;
  signature: string;
}

export function parsePassToken(raw: string): ParsedToken | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 3) return null;
  const [requestId, nonce, signature] = parts;
  if (!requestId || !nonce || !signature) return null;
  return { requestId, nonce, signature };
}

/** Constant-time comparison — a plain === on a secret-derived value leaks timing info. */
export function verifyPassSignature(requestId: string, nonce: string, signature: string): boolean {
  const expected = Buffer.from(computeSignature(requestId, nonce), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
