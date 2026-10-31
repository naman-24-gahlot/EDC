// SERVER-ONLY. The live "is this OK?" checks the registration form runs while you type
// (/api/register/check). Submitting still re-checks everything in createPerson — these only
// warn early. Usernames are public-facing, so "taken" is fine to say. Whether an EMAIL is
// registered is not said while typing (it would tell anyone whether a person is registered with
// EDC); it is said when the confirmation link is requested, which is rate limited much harder.
// The check is rate limited per IP (proxy.ts) to stop bulk probing.
if (typeof window !== 'undefined') {
  throw new Error('lib/registrationChecks.ts must never be imported into client code.');
}

import { promises as dns } from 'dns';
import { adminDb } from '@/lib/firebase/admin';
import { testModeOn } from '@/lib/testMode';

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

// Throwaway-inbox services (a short list of the common ones; free, no dependency).
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', '10minutemail.com', 'temp-mail.org', 'tempmail.com',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com',
  'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempinbox.com', 'spamgourmet.com', 'mailnesia.com', 'tempr.email',
  'discard.email', 'burnermail.io', 'moakt.com', 'tmail.ws', 'tmpmail.org', 'mail.tm', 'emailfake.com', 'inboxkitten.com',
]);
// Typos of big providers people actually make.
const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'yahoo.co': 'yahoo.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com',
  'rediffmail.co': 'rediffmail.com',
};

export type FieldVerdict = { ok: boolean; message: string | null };

export async function checkUsername(raw: string): Promise<FieldVerdict> {
  const u = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return { ok: false, message: '3–30 characters: lowercase letters, numbers, dot, dash or underscore.' };
  const taken = (await adminDb.collection('identifiers').doc(u).get()).exists;
  return taken ? { ok: false, message: 'That username is taken.' } : { ok: true, message: 'Available.' };
}

/** Does this domain accept email at all? (MX record, or an address record as the fallback.) */
async function domainTakesMail(domain: string): Promise<boolean | null> {
  try {
    if ((await dns.resolveMx(domain)).length > 0) return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') return null; // DNS trouble: don't block anyone
  }
  try {
    return (await dns.resolve4(domain)).length > 0;
  } catch {
    return false;
  }
}

/** `live`: the as-you-type hint — never reveals whether the address is already registered. */
export async function checkEmail(raw: string, { live = false }: { live?: boolean } = {}): Promise<FieldVerdict> {
  const email = raw.trim();
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, message: 'That doesn’t look like an email address.' };
  const domain = email.split('@')[1].toLowerCase();
  if (TYPOS[domain]) return { ok: false, message: `Did you mean …@${TYPOS[domain]}?` };
  if (DISPOSABLE.has(domain)) return { ok: false, message: 'Throwaway inboxes can’t be used — we email you sign-in links.' };
  if (!live && (await adminDb.collection('identifiers').doc(email.toLowerCase()).get()).exists) return { ok: false, message: 'Already registered — sign in instead.' };
  if (domain.endsWith('.test')) {
    return (await testModeOn())
      ? { ok: true, message: 'Test address: emails go to the test outbox.' }
      : { ok: false, message: 'Test email addresses only work while testing mode is on — use a real email address.' };
  }
  const takesMail = await domainTakesMail(domain);
  if (takesMail === false) return { ok: false, message: `“${domain}” can’t receive email — check the spelling.` };
  return { ok: true, message: 'We’ll email a link to confirm it’s yours.' };
}
