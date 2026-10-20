import type { SystemRole } from '@/lib/roles';
import { LogoutButton } from './LogoutButton';

const ROLE_STYLES: Record<SystemRole, string> = {
  member: 'bg-blue-100 text-blue-800',
  master: 'bg-purple-100 text-purple-800',
  guard: 'bg-amber-100 text-amber-800',
};

const ROLE_LABEL: Record<SystemRole, string> = {
  member: 'Member',
  master: 'Master',
  guard: 'Guard',
};

// Genuinely cross-role, purely presentational (same precedent as LogoutButton) — a shared
// page shell, not role-specific feature UI. Makes the signed-in role unmistakable.
export function RoleHeader({ role, subtitle }: { role: SystemRole; subtitle?: string }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">EDC Access</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${ROLE_STYLES[role]}`}>
          {ROLE_LABEL[role]}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
        <LogoutButton />
      </div>
    </div>
  );
}
