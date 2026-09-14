// Day boundary is IST (Asia/Kolkata) — this system serves an Indian college campus,
// so "today" must mean the campus's local day, not the server host's UTC day.
// Consolidated here (was duplicated in the Employee and Admin sessions) now that a
// third call site (QR verification) needs the identical logic — correctness-critical
// duplication, not the kind worth tolerating.
export function todayDateString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
