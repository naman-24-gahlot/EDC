// Day boundary is IST (Asia/Kolkata) — this system serves an Indian college campus,
// so "today" must mean the campus's local day, not the server host's UTC day.
// Consolidated here (was duplicated in the Employee and Admin sessions) now that a
// third call site (QR verification) needs the identical logic — correctness-critical
// duplication, not the kind worth tolerating.
export function todayDateString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export interface IstNow {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 = Sunday … 6 = Saturday
  time: string; // HH:MM, 24h
}

const IST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function nowInIST(at: Date = new Date()): IstNow {
  const parts = Object.fromEntries(IST_PARTS.formatToParts(at).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, weekday: weekdayOf(date), time: `${parts.hour}:${parts.minute}` };
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** YYYY-MM-DD shifted by whole days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
