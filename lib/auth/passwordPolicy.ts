// SERVER-ONLY. Enforces the password rules (lib/passwordStrength.ts) wherever a person chooses a
// password: registration, change, forced change after a reset, reset by email link.
if (typeof window !== 'undefined') {
  throw new Error('lib/auth/passwordPolicy.ts must never be imported into client code.');
}

import { HttpError } from '@/lib/hierarchy/authorize';
import { breachCount, passwordProblem, type StrengthContext } from '@/lib/passwordStrength';

/** Throws 400 with a plain message if the password breaks a rule or is in a known breach. */
export async function assertGoodPassword(pw: unknown, ctx: StrengthContext = {}): Promise<string> {
  if (typeof pw !== 'string') throw new HttpError(400, 'Enter a password.');
  const problem = passwordProblem(pw, ctx);
  if (problem) throw new HttpError(400, problem);
  // Fail open: if the breach service can't be reached, the other rules still apply.
  const seen = await breachCount(pw);
  if (seen && seen > 0) throw new HttpError(400, `This password has appeared in ${seen.toLocaleString('en-IN')} data breaches, so attackers try it first. Choose a different one.`);
  return pw;
}
