// SERVER-ONLY. Testing mode — one switch, Master only (/admin), for everything that exists only to
// make testing easier. Turn it OFF to present or to go live. It is ON until a Master turns it off
// (so nothing changes for testing until then).
//
// What it switches — keep this list complete when adding to it (CLAUDE.md "Testing mode"):
//   1. Test email addresses (…@….test): accepted for new sign-ups/emails, and their mail goes to
//      the Master's test outbox (/admin/outbox). OFF: new ones are refused.
//   2. Full registration form: name, mobile and purpose may be left blank (filled with
//      "Test" / "User" / "Testing"; no mobile stored). OFF: all required, as normal.
//   3. Cloudflare Turnstile ("I'm human"): not asked for. OFF: asked for on the public forms
//      whenever its keys are set (lib/turnstile.ts).
//
// settings/app: { testMode: boolean, changedBy, changedAt }. Read through a 10-second memory per
// server (and per route), so a change reaches every form within 10 seconds; the Master's bar reads it fresh.
if (typeof window !== 'undefined') {
  throw new Error('lib/testMode.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { HttpError, requireMaster } from '@/lib/hierarchy/authorize';
import { audit } from '@/lib/audit';
import type { SessionUser } from '@/lib/session';
import { isTestAddress } from '@/lib/auth/emailActions';

const REF = () => adminDb.collection('settings').doc('app');
const MEMORY_MS = 10_000;
let memory: { at: number; on: boolean } | null = null;

/** `fresh`: skip the memory (the Master's own bar, so a switch shows at once). */
export async function testModeOn({ fresh = false }: { fresh?: boolean } = {}): Promise<boolean> {
  if (!fresh && memory && Date.now() - memory.at < MEMORY_MS) return memory.on;
  const on = (await REF().get()).get('testMode') !== false; // missing = on (how things worked before the switch)
  memory = { at: Date.now(), on };
  return on;
}

export async function setTestMode(actor: SessionUser, on: unknown): Promise<{ testMode: boolean }> {
  requireMaster(actor);
  if (typeof on !== 'boolean') throw new HttpError(400, 'Send { testMode: true | false }.');
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.set(REF(), { testMode: on, changedBy: actor.personId, changedAt: now }, { merge: true });
  audit(batch, { action: 'TEST_MODE_CHANGED', actor, targetPersonId: null, at: now, details: on ? 'testing mode switched ON' : 'testing mode switched OFF' });
  await batch.commit();
  memory = { at: Date.now(), on };
  return { testMode: on };
}

/** 1. A test address (….test) may be used only in testing mode. Throws a plain 400 otherwise. */
export async function assertAddressAllowed(email: string | null | undefined): Promise<void> {
  if (email && isTestAddress(email) && !(await testModeOn())) {
    throw new HttpError(400, 'Test email addresses (….test) only work while testing mode is on — use a real email address.');
  }
}
