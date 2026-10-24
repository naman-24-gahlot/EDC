// SERVER-ONLY. Campus holidays — DATABASE_SCHEMA.md "holidays". A Master adds a date (doc id =
// YYYY-MM-DD, so one holiday per day) and picks which profile types it closes the campus for;
// on that day the gate answers "Campus holiday" for them, whatever their weekday/hour rules say.
// Event guests and visitors are not closed out by default: their passes are for specific dates
// someone chose on purpose.
if (typeof window !== 'undefined') {
  throw new Error('lib/holidays.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';
import type { SessionUser } from '@/lib/session';
import { HttpError, requireMaster } from '@/lib/hierarchy/authorize';
import { PROFILE_TYPES, isProfileType, type ProfileType } from '@/lib/access/codes';
import { audit } from '@/lib/audit';

export interface Holiday { date: string; name: string; appliesTo: ProfileType[]; createdBy: string; createdAt: Timestamp }

export const HOLIDAY_DEFAULT_TYPES: ProfileType[] = ['employee', 'incubee', 'driver', 'relative', 'bodyguard'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const col = () => adminDb.collection('holidays');

// The gate asks on every scan; a holiday changes rarely. Per-instance, 60 s, cleared on change here.
const cache = new Map<string, { at: number; h: Holiday | null }>();

export async function holidayOn(date: string): Promise<Holiday | null> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < 60_000) return hit.h;
  const snap = await col().doc(date).get();
  const h = snap.exists ? (snap.data() as Holiday) : null;
  cache.set(date, { at: Date.now(), h });
  return h;
}

/** From 30 days ago onwards, soonest first. */
export async function listHolidays(): Promise<Holiday[]> {
  const snap = await col().where('date', '>=', addDays(todayDateString(), -30)).orderBy('date').get();
  return snap.docs.map((d) => d.data() as Holiday);
}

export function parseHolidayInput(body: unknown): { date: string; name: string; appliesTo: ProfileType[] } {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const date = typeof raw.date === 'string' ? raw.date : '';
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Pick a date.');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 80) throw new HttpError(400, 'Give the holiday a name (up to 80 characters).');
  const types = Array.isArray(raw.appliesTo) ? [...new Set(raw.appliesTo.filter(isProfileType))] : HOLIDAY_DEFAULT_TYPES;
  if (types.length === 0) throw new HttpError(400, 'Choose at least one group the campus is closed for.');
  return { date, name, appliesTo: PROFILE_TYPES.filter((t) => types.includes(t)) };
}

export async function addHoliday(actor: SessionUser, input: { date: string; name: string; appliesTo: ProfileType[] }) {
  requireMaster(actor);
  if (input.date < todayDateString()) throw new HttpError(400, 'That date has already passed.');
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.create(col().doc(input.date), { ...input, createdBy: actor.personId, createdAt: now });
  audit(batch, { action: 'HOLIDAY_ADDED', actor, targetPersonId: null, subjectId: input.date, at: now, details: `${input.date} "${input.name}" — closed for ${input.appliesTo.join(', ')}` });
  try {
    await batch.commit();
  } catch (err) {
    if ((err as { code?: number }).code === 6) throw new HttpError(409, 'There is already a holiday on that date — remove it first to change it.');
    throw err;
  }
  cache.delete(input.date);
  return input;
}

export async function removeHoliday(actor: SessionUser, date: string) {
  requireMaster(actor);
  if (!DATE_RE.test(date)) throw new HttpError(404, 'Holiday not found.');
  const ref = col().doc(date);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Holiday not found.');
  const batch = adminDb.batch();
  batch.delete(ref);
  audit(batch, { action: 'HOLIDAY_REMOVED', actor, targetPersonId: null, subjectId: date, details: `${date} "${snap.data()!.name}"` });
  await batch.commit();
  cache.delete(date);
  return { date };
}
