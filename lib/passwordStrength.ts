// Client-safe. Password rules shared by the browser (live hints while typing) and the server
// (lib/auth/passwordPolicy.ts enforces them). No dependency: length, variety, the person's own
// details, and a short list of the passwords people pick most.

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'iloveyou',
  'admin123', 'welcome1', 'welcome123', 'abc12345', 'letmein1', 'football', 'baseball', 'sunshine', 'princess',
  'india123', 'iimjammu', 'jammu123', 'edc12345', 'password@123', 'pass@123', 'admin@123', 'test1234', 'changeme',
]);

export interface StrengthContext { username?: string; email?: string; name?: string }
export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; problem: string | null; tips: string[] }

/** The one rule-breaker to show, or null if the password is acceptable. */
export function passwordProblem(pw: string, ctx: StrengthContext = {}): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (/^(.)\1+$/.test(pw)) return 'Don’t repeat one character.';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9@]/g, ''))) return 'That’s one of the most common passwords — pick something less guessable.';
  const own = [ctx.username, ctx.email?.split('@')[0], ...(ctx.name ?? '').split(/\s+/)].filter((x): x is string => !!x && x.length >= 3).map((x) => x.toLowerCase());
  if (own.some((x) => lower.includes(x))) return 'Don’t use your name, username or email in your password.';
  return null;
}

export function passwordStrength(pw: string, ctx: StrengthContext = {}): Strength {
  const problem = pw ? passwordProblem(pw, ctx) : null;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = (pw.length >= 8 ? 1 : 0) + (pw.length >= 12 ? 1 : 0) + (pw.length >= 16 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  if (problem) score = Math.min(score, 1);
  const tips: string[] = [];
  if (pw.length < 12) tips.push('Longer is stronger — 12+ characters, or a few unrelated words.');
  if (kinds < 3) tips.push('Mix letters, numbers and a symbol.');
  const s = Math.max(0, Math.min(4, score)) as Strength['score'];
  return { score: s, label: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s], problem, tips };
}

/** SHA-1 hex (upper case) — the format Have I Been Pwned's range API uses. Works in browser and Node 18+. */
export async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * How many times this password appears in known data breaches (Have I Been Pwned, free, no key).
 * Only the first 5 characters of its SHA-1 leave this device (k-anonymity). null = couldn't check.
 */
export async function breachCount(pw: string, timeoutMs = 3000): Promise<number | null> {
  try {
    const hash = await sha1Hex(pw);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const line = (await res.text()).split('\n').find((l) => l.startsWith(hash.slice(5)));
    return line ? Number(line.split(':')[1]) || 0 : 0;
  } catch {
    return null;
  }
}
