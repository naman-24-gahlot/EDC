import type { SystemRole } from '@/lib/roles';
import { LogoutButton } from './LogoutButton';
import { IimLockup, IimMark } from './brand/Logos';

const ROLE_STYLES: Record<SystemRole, string> = {
  member: 'bg-iim-sky text-iim-navy ring-iim-blue/25',
  master: 'bg-iim-navy text-white ring-iim-navy',
  guard: 'bg-amber-100 text-amber-900 ring-amber-300',
};

const ROLE_LABEL: Record<SystemRole, string> = {
  member: 'Member',
  master: 'Master',
  guard: 'Guard',
};

// Genuinely cross-role, purely presentational (same precedent as LogoutButton) — a shared
// page shell, not role-specific feature UI. Makes the signed-in role unmistakable.
// IIM Jammu's lockup (the upright mark on phones), "EDC Access" and the role, over a brand rule:
// navy into blue with the logo's red divider (.brand-rule in app/globals.css).
export function RoleHeader({ role, subtitle }: { role: SystemRole; subtitle?: string }) {
  return (
    <header className="mb-6">
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <IimMark className="h-11 sm:hidden" />
          <IimLockup className="hidden h-12 sm:block" />
          <span aria-hidden className="h-9 w-px shrink-0 bg-iim-red/70 sm:bg-gray-200" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold tracking-tight text-iim-navy">EDC Access</span>
            <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${ROLE_STYLES[role]}`}>
              {ROLE_LABEL[role]}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {subtitle && <span className="hidden min-w-0 truncate text-xs text-gray-500 md:inline">{subtitle}</span>}
          <LogoutButton />
        </div>
      </div>
      <div aria-hidden className="brand-rule" />
    </header>
  );
}
