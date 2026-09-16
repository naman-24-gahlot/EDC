// systemRole gates which AREA of the app an account may reach at all. It is NOT the
// same thing as profileType (employee/incubee/.../driver etc. on the person doc) and
// it never grants authority over another person by itself — see assertCanActOn in
// lib/hierarchy/ (from P4) and SECURITY_MODEL.md "Two authorization axes".
export type SystemRole = 'master' | 'guard' | 'member';

export const SYSTEM_ROLES: readonly SystemRole[] = ['master', 'guard', 'member'] as const;

export function isSystemRole(value: unknown): value is SystemRole {
  return typeof value === 'string' && (SYSTEM_ROLES as readonly string[]).includes(value);
}

export const ROLE_HOME_PATH: Record<SystemRole, string> = {
  master: '/admin',
  guard: '/guard',
  member: '/employee', // moved to /me in P9
};
