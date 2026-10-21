// Categories, sorting and filters for people lists. Pure presentation helpers over people the
// server has ALREADY scoped (Master: everyone; employee: their descendants) — never a scope.
import type { PersonRecord } from '@/lib/hierarchy/authorize';

export const CATEGORIES = [
  ['all', 'All'], ['employee', 'Employees'], ['incubee', 'Incubees'], ['guest', 'Event guests'],
  ['dependant', 'Drivers, relatives & bodyguards'], ['master', 'Masters'], ['guard', 'Guards'],
] as const;
export type Category = (typeof CATEGORIES)[number][0];

export const SORTS = [['name', 'Name A–Z'], ['recent', 'Recently at gate'], ['newest', 'Newest'], ['code', 'Access code']] as const;
export type Sort = (typeof SORTS)[number][0];

export const VIEWS = [['list', 'List'], ['cards', 'Cards']] as const;
export type View = (typeof VIEWS)[number][0];

export function categoryOf(p: PersonRecord): Exclude<Category, 'all'> {
  if (p.systemRole === 'master') return 'master';
  if (p.systemRole === 'guard') return 'guard';
  if (p.profileType === 'employee') return 'employee';
  if (p.profileType === 'incubee') return 'incubee';
  if (p.profileType === 'event_guest') return 'guest';
  return 'dependant';
}

const pick = <T extends string>(raw: string | undefined, options: readonly (readonly [T, string])[]): T =>
  (options.find(([v]) => v === raw)?.[0] ?? options[0][0]);
export const parseCategory = (raw?: string) => pick<Category>(raw, CATEGORIES);
export const parseSort = (raw?: string) => pick<Sort>(raw, SORTS);
export const parseView = (raw?: string) => pick<View>(raw, VIEWS);

const millis = (v: unknown) => (v as { toMillis?: () => number } | null | undefined)?.toMillis?.() ?? 0;
export const lastEntryMillis = (p: PersonRecord) => millis(p.lastEntryAt);

export function sortPeople(list: PersonRecord[], sort: Sort, codeOf: (p: PersonRecord) => string): PersonRecord[] {
  const byName = (a: PersonRecord, b: PersonRecord) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
  const cmp: Record<Sort, (a: PersonRecord, b: PersonRecord) => number> = {
    name: byName,
    recent: (a, b) => lastEntryMillis(b) - lastEntryMillis(a) || byName(a, b), // never-seen last
    newest: (a, b) => millis(b.createdAt) - millis(a.createdAt) || byName(a, b),
    code: (a, b) => (codeOf(a) || '~').localeCompare(codeOf(b) || '~') || byName(a, b),
  };
  return [...list].sort(cmp[sort]);
}

export function countByCategory(list: PersonRecord[]): Record<Category, number> {
  const out = Object.fromEntries(CATEGORIES.map(([c]) => [c, 0])) as Record<Category, number>;
  for (const p of list) { out[categoryOf(p)]++; out.all++; }
  return out;
}
