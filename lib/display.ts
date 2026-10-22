// Display helpers shared by /me and /admin. Presentation only — no access rules here.
import type { ProfileType } from '@/lib/access/codes';
import type { EffectiveStatus } from '@/lib/access/entitlements';

export const PROFILE_LABEL: Record<ProfileType, string> = {
  employee: 'Employee',
  incubee: 'Incubee',
  event_guest: 'Event Guest',
  driver: 'Driver',
  relative: 'Relative',
  bodyguard: 'Bodyguard',
};

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function daysLabel(weekdays: number[]): string {
  const key = [...weekdays].sort((a, b) => a - b).join('');
  if (key === '0123456') return 'Every day';
  if (key === '12345') return 'Mon–Fri';
  if (key === '123456') return 'Mon–Sat';
  return [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY[d]).join(', ');
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** The person-facing access status: the entitlement's effective status, not the time-of-day verdict. */
export type AccessStatus = 'ACTIVE' | 'NONE' | 'EXPIRED' | 'REVOKED' | 'DEACTIVATED' | 'NOT YET ACTIVE' | 'PENDING APPROVAL' | 'REJECTED';

export function accessStatus(
  person: { registrationStatus: string; active: boolean },
  effective: EffectiveStatus | null
): AccessStatus {
  if (person.registrationStatus === 'REJECTED') return 'REJECTED';
  if (person.registrationStatus !== 'APPROVED') return 'PENDING APPROVAL';
  if (!person.active) return 'DEACTIVATED'; // the account is off — not the same as an access period being revoked
  if (!effective || effective === 'SUPERSEDED') return 'NONE';
  if (effective === 'SCHEDULED') return 'NOT YET ACTIVE';
  return effective;
}

export const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  NONE: 'bg-gray-100 text-gray-700 ring-gray-300',
  EXPIRED: 'bg-amber-100 text-amber-800 ring-amber-300',
  PENDING: 'bg-amber-100 text-amber-800 ring-amber-300',
  'PENDING APPROVAL': 'bg-amber-100 text-amber-800 ring-amber-300',
  REVOKED: 'bg-red-100 text-red-800 ring-red-300',
  REJECTED: 'bg-red-100 text-red-800 ring-red-300',
  'NOT YET ACTIVE': 'bg-sky-100 text-sky-800 ring-sky-300',
  SCHEDULED: 'bg-sky-100 text-sky-800 ring-sky-300',
  SUPERSEDED: 'bg-gray-100 text-gray-500 ring-gray-200',
  DENIED: 'bg-red-100 text-red-800 ring-red-300',
  DEACTIVATED: 'bg-red-100 text-red-800 ring-red-300',
  'LINK OPEN': 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  'LINK CLOSED': 'bg-gray-100 text-gray-700 ring-gray-300',
  'LINK EXPIRED': 'bg-amber-100 text-amber-800 ring-amber-300',
  GUARD: 'bg-amber-50 text-amber-800 ring-amber-200',
  MASTER: 'bg-purple-100 text-purple-800 ring-purple-300',
};

/** "21 Oct 2026 → 19 Nov 2026 · Mon–Sat · 08:00–20:00" for any access period. */
export function windowSummary(w: { startDate: string; endDate: string | null; weekdays: number[]; startTime: string; endTime: string }): string {
  return `${w.endDate ? `${formatDate(w.startDate)} → ${formatDate(w.endDate)}` : `from ${formatDate(w.startDate)}, no end date`} · ${daysLabel(w.weekdays)} · ${w.startTime}–${w.endTime}`;
}
