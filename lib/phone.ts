// Client-safe. One mobile-number rule for the forms (live hint) and the server (enforced in
// createPerson and profile edits). Indian numbers are the norm; other countries need a + code.

const FAKE = new Set(['1234567890', '0123456789', '9876543210', '0987654321']);

export interface MobileVerdict { ok: boolean; value: string | null; message: string | null }

/** Checks a typed number and returns it in one stored form: +91XXXXXXXXXX, or +<country><number>. */
export function checkMobile(raw: string): MobileVerdict {
  const s = raw.trim().replace(/[\s().-]/g, '');
  if (!s) return { ok: false, value: null, message: 'Enter a mobile number.' };
  if (!/^\+?\d+$/.test(s)) return { ok: false, value: null, message: 'Use digits only (a leading + is fine).' };

  // India: 10 digits starting 6–9, optionally written with +91, 91 or a leading 0.
  const india = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(s);
  if (india) {
    const n = india[1];
    if (/^(\d)\1{9}$/.test(n) || FAKE.has(n)) return { ok: false, value: null, message: 'That looks like a placeholder number — enter your real mobile.' };
    return { ok: true, value: `+91${n}`, message: null };
  }
  if (/^(?:\+91|91|0)?\d{10}$/.test(s)) return { ok: false, value: null, message: 'Indian mobile numbers start with 6, 7, 8 or 9.' };
  if (!s.startsWith('+')) return { ok: false, value: null, message: 'Enter a 10-digit Indian mobile number, or + and the country code for others.' };
  // Other countries: + country code (not 0) and 8–15 digits in all (E.164).
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return { ok: false, value: null, message: 'That isn’t a valid international number (+ country code, 8–15 digits).' };
  if (/^\+\d?(\d)\1{7,}$/.test(s)) return { ok: false, value: null, message: 'That looks like a placeholder number — enter your real mobile.' };
  return { ok: true, value: s, message: 'International number.' };
}
