export type Role = 'employee' | 'admin' | 'guard';

export const ROLES: readonly Role[] = ['employee', 'admin', 'guard'] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const ROLE_HOME_PATH: Record<Role, string> = {
  employee: '/employee',
  admin: '/admin',
  guard: '/guard',
};
