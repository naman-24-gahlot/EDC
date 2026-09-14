import { LogoutButton } from './LogoutButton';

const ROLE_STYLES: Record<string, string> = {
  employee: 'bg-blue-100 text-blue-800',
  admin: 'bg-purple-100 text-purple-800',
  guard: 'bg-amber-100 text-amber-800',
};

// Genuinely cross-role, purely presentational (same precedent as LogoutButton) —
// not a violation of "no cross-imports between employee/admin/guard folders",
// which is about role-specific feature UI, not a shared page shell. Makes the
// active role unmistakable at a glance, consistently, on every screen.
export function RoleHeader({
  role,
  subtitle,
}: {
  role: 'employee' | 'admin' | 'guard';
  subtitle?: string;
}) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">EDC Access</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${ROLE_STYLES[role]}`}
        >
          {role}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
        <LogoutButton />
      </div>
    </div>
  );
}
