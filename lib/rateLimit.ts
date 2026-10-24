// In-memory, per-instance rate limiting — the first line of defence against floods and
// mistakes (double-submits, a stuck script, a scraper). Deliberately writes NOTHING to
// Firestore: a limiter that costs a database write per attempt could itself be used to burn
// the free tier's daily write quota. Per-instance means best-effort on serverless (Fluid
// compute reuses instances, so it holds well in practice); Firebase Auth additionally locks
// out repeated wrong passwords per account on its own side.

interface Bucket {
  count: number;
  resetAt: number;
}

export interface LimitRule {
  /** Distinct bucket name, e.g. "login". */
  name: string;
  max: number;
  windowMs: number;
}

export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
}

const MAX_KEYS = 20_000;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private now: () => number = Date.now) {}

  hit(rule: LimitRule, key: string): LimitResult {
    const t = this.now();
    const id = `${rule.name}|${key}`;
    let b = this.buckets.get(id);
    if (!b || b.resetAt <= t) {
      if (this.buckets.size >= MAX_KEYS) this.sweep(t);
      b = { count: 0, resetAt: t + rule.windowMs };
      this.buckets.set(id, b);
    }
    b.count++;
    if (b.count > rule.max) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
    return { ok: true, retryAfterSec: 0 };
  }

  /** Drop expired buckets; if still full (a flood of distinct keys), drop the oldest half. */
  private sweep(t: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
    if (this.buckets.size >= MAX_KEYS) {
      let i = 0;
      for (const k of this.buckets.keys()) {
        if (i++ >= MAX_KEYS / 2) break;
        this.buckets.delete(k);
      }
    }
  }

  get size() {
    return this.buckets.size;
  }
}

const MIN = 60_000;

/**
 * Sized so a real person never meets them. Keys follow the PERSON, not just the IP: a whole
 * campus can share one Wi-Fi address, so per-IP budgets are only a high ceiling against scripts.
 */
export const RULES = {
  loginPerAccount: { name: 'login-acct', max: 10, windowMs: 10 * MIN }, // per IP + identifier
  loginPerIp: { name: 'login-ip', max: 300, windowMs: 10 * MIN },
  registerPerIp: { name: 'register-ip', max: 30, windowMs: 60 * MIN },
  emailPerIp: { name: 'email-ip', max: 10, windowMs: 10 * MIN }, // forgot-password / verification emails
  checkPerIp: { name: 'check-ip', max: 120, windowMs: MIN }, // live 'is this taken?' checks while typing
  gatePerSession: { name: 'gate', max: 120, windowMs: MIN },
  writePerSession: { name: 'write', max: 60, windowMs: MIN },
  readPerSession: { name: 'read', max: 300, windowMs: MIN },
  anyPerIp: { name: 'ip', max: 3000, windowMs: MIN },
} satisfies Record<string, LimitRule>;

export interface RequestFacts {
  method: string;
  pathname: string;
  ip: string;
  /** Opaque per-session key (a hash of the session cookie), or null when signed out. */
  sessionKey: string | null;
}

/** Shared by the login route for the per-account budget (it needs the parsed body). */
export const loginLimiter = new RateLimiter();

/** On Vercel these headers are set by the edge and can't be spoofed by the client. */
export function clientIpFrom(headers: Headers): string {
  return headers.get('x-real-ip') || headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

/** Every bucket this request counts against; the request is refused if ANY is exhausted. */
export function bucketsFor(r: RequestFacts): { rule: LimitRule; key: string }[] {
  const who = r.sessionKey ? `s:${r.sessionKey}` : `ip:${r.ip}`;
  const out = [{ rule: RULES.anyPerIp, key: r.ip }];
  if (r.method === 'POST' && r.pathname === '/api/auth/session') {
    out.push({ rule: RULES.loginPerIp, key: r.ip }); // per-account budget: see the login route
  } else if (r.method === 'POST' && (r.pathname === '/api/auth/forgot' || r.pathname === '/api/me/verify-email' || r.pathname === '/api/register/email-check')) {
    out.push({ rule: RULES.emailPerIp, key: r.ip });
  } else if (r.pathname === '/api/register/check' || r.pathname === '/api/register/email-check') {
    out.push({ rule: RULES.checkPerIp, key: r.ip });
  } else if (r.method === 'POST' && r.pathname === '/api/register') {
    out.push({ rule: RULES.registerPerIp, key: r.ip });
  } else if (r.method === 'POST' && r.pathname === '/api/guard/verify') {
    out.push({ rule: RULES.gatePerSession, key: who });
  } else if (r.method !== 'GET' && r.method !== 'HEAD') {
    out.push({ rule: RULES.writePerSession, key: who });
  } else {
    out.push({ rule: RULES.readPerSession, key: who });
  }
  return out;
}
