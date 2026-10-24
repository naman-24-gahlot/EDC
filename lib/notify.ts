// SERVER-ONLY. What each app email says (lib/mail.ts sends it). Every message goes to the person's
// email and, when they added one, their backup email. Called with `after()` from route handlers,
// so an email never slows down or fails the action itself.
if (typeof window !== 'undefined') {
  throw new Error('lib/notify.ts must never be imported into client code.');
}

import { adminDb } from '@/lib/firebase/admin';
import { toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { accessCodeFor, type ProfileType } from '@/lib/access/codes';
import { PROFILE_LABEL, formatDate, windowSummary } from '@/lib/display';
import { loadEvent } from '@/lib/events';
import { sendMail, type MailKind } from '@/lib/mail';

const SIGN_OFF = '\n— EDC Access, IIM Jammu\nThis is an automatic email; replies aren’t read.';

const load = async (id: string | null | undefined) => (id ? toPerson(await adminDb.collection('people').doc(id).get()) : null);
const name = (p: PersonRecord) => `${p.firstName} ${p.lastName}`;
const recipients = (p: PersonRecord) => [p.commEmail as string | undefined, p.backupEmail as string | undefined];
const label = (t: string | null | undefined) => (t ? PROFILE_LABEL[t as ProfileType] ?? t : '—');

type Window = { startDate: string; endDate: string | null; weekdays: number[]; startTime: string; endTime: string; allowOvernight?: boolean };

function send(kind: MailKind, p: PersonRecord, subject: string, lines: (string | null | false | undefined)[]) {
  return sendMail({ kind, personId: p.personId, to: recipients(p), subject, text: lines.filter((l) => l !== null && l !== false && l !== undefined).join('\n') + '\n' + SIGN_OFF });
}

async function eventBlock(p: PersonRecord): Promise<string[]> {
  const e = typeof p.eventId === 'string' ? await loadEvent(p.eventId) : null;
  if (!e) return [];
  return ['', 'Your event', `  ${e.name}`, e.details ? `  ${e.details}` : '', e.venue ? `  Venue: ${e.venue}` : '',
    `  ${formatDate(e.accessFrom)}${e.accessTo !== e.accessFrom ? ` → ${formatDate(e.accessTo)}` : ''}, gate open ${e.gateOpens}–${e.gateCloses}`].filter(Boolean);
}

/** Registration approved: their profile, what they were approved as, event details, and access. */
export async function notifyRegistrationApproved(personId: string, origin: string, access: Window | null) {
  const p = await load(personId);
  if (!p) return;
  const parent = await load(p.parentId);
  const code = accessCodeFor(p.profileType, p.accessNumber);
  const applied = (p.registrationDecision as { appliedProfileType?: string } | undefined)?.appliedProfileType;
  return send('REGISTRATION_APPROVED', p, 'Your EDC registration is approved', [
    `Hello ${p.firstName},`, '', 'Your registration has been approved. Here is your profile:', '',
    `  Name: ${name(p)}`, `  Username: ${p.username}`,
    `  Profile: ${label(p.profileType)}${applied && applied !== p.profileType ? ` (you applied as ${label(applied)})` : ''}`,
    parent && `  Registered under: ${name(parent)}`,
    code && `  Access code: ${code}`,
    ...(await eventBlock(p)),
    '', 'Your access',
    access ? `  ${windowSummary(access)}` : '  No access period yet — sign in and request access when you need it.',
    '', 'At the gate, show the QR code from your entry pass, or tell the guard your access code.',
    `Entry pass: ${origin}/me/pass`, `Sign in: ${origin}/login (username: ${p.username})`,
  ]);
}

export async function notifyRegistrationRejected(personId: string, note: string | null) {
  const p = await load(personId);
  if (!p) return;
  return send('REGISTRATION_REJECTED', p, 'Your EDC registration was not approved', [
    `Hello ${p.firstName},`, '', 'Your registration was not approved.', note && `Reason given: ${note}`,
    '', 'If you think this is a mistake, contact the person you registered under or the EDC office.',
  ]);
}

/** A request (or a direct grant) gave them access. */
export async function notifyAccessApproved(entitlementId: string, origin: string) {
  const ent = (await adminDb.collection('entitlements').doc(entitlementId).get()).data() as (Window & { personId: string }) | undefined;
  if (!ent) return;
  const p = await load(ent.personId);
  if (!p) return;
  return send('ACCESS_APPROVED', p, 'Your EDC access is approved', [
    `Hello ${p.firstName},`, '', 'Your access has been approved:', `  ${windowSummary(ent)}`,
    '', `Access code: ${accessCodeFor(p.profileType, p.accessNumber) ?? '—'}`, `Entry pass: ${origin}/me/pass`,
  ]);
}

/** A visitor pass: the link IS the pass (no account), so it goes only to the visitor's own email. */
export async function notifyVisitorPass(personId: string, passUrl: string, access: Window) {
  const p = await load(personId);
  if (!p) return;
  const host = await load(p.parentId);
  return send('VISITOR_PASS', p, `Your visitor pass for EDC${p.vvip ? ' (VVIP)' : ''}`, [
    `Hello ${p.firstName},`, '', `${host ? name(host) : 'EDC'} has arranged a visitor pass for you.`, '',
    `  Valid: ${windowSummary(access)}`, `  Access code: ${accessCodeFor(p.profileType, p.accessNumber) ?? '—'}`,
    p.purpose ? `  Purpose: ${p.purpose}` : null,
    '', 'Show this pass (QR code) at the gate:', passUrl, '', 'Keep the link to yourself — it works as your pass until it expires.',
  ]);
}

/** Tells the host their visitor has just come in. */
export async function notifyVisitorArrived(personId: string) {
  const v = await load(personId);
  const host = await load(v?.parentId);
  if (!v || !host) return;
  return send('VISITOR_ARRIVED', host, `${v.vvip ? 'VVIP ' : ''}visitor arrived: ${name(v)}`, [
    `Hello ${host.firstName},`, '', `Your ${v.vvip ? 'VVIP ' : ''}visitor ${name(v)} has just been let in at the gate.`, v.purpose ? `Purpose: ${v.purpose}` : null,
  ]);
}

/** A stay alert goes to the person's immediate parent, or to every Master for top-level people. */
export async function notifyStayAlert(personId: string, what: string, origin: string) {
  const p = await load(personId);
  if (!p) return;
  const parent = await load(p.parentId);
  const to = parent ? [parent] : (await adminDb.collection('people').where('systemRole', '==', 'master').get()).docs.map((d) => toPerson(d)!);
  await Promise.all(to.map((r) => send('STAY_ALERT', r, `Stay alert: ${name(p)}`, [
    `Hello ${r.firstName},`, '', `${name(p)} (${label(p.profileType)}) ${what}.`, '', `See it and mark it as seen: ${origin}${r.systemRole === 'master' ? '/admin/stays' : '/me#stays'}`,
  ])));
}

export async function notifyLeaveDecided(personId: string, approved: boolean, range: string, note: string | null) {
  const p = await load(personId);
  if (!p) return;
  return send('LEAVE_DECIDED', p, `Your leave request was ${approved ? 'approved' : 'not approved'}`, [
    `Hello ${p.firstName},`, '', `Your leave for ${range} was ${approved ? 'approved' : 'not approved'}.`, note && `Note: ${note}`,
  ]);
}

/** Forgot password, second copy: the reset link to the backup email the person added themselves. */
export async function sendResetToBackup(p: PersonRecord, link: string) {
  if (typeof p.backupEmail !== 'string' || !p.backupEmail) return;
  return sendMail({ kind: 'PASSWORD_RESET_BACKUP', personId: p.personId, to: [p.backupEmail], subject: 'Reset your EDC password', text: [
    `Hello ${p.firstName},`, '', 'Someone (hopefully you) asked to reset the password for your EDC account. You get this copy because this is the backup email on the account.',
    '', 'Choose a new password here (the link works once, for about an hour):', link, '', 'If you didn’t ask for this, ignore this email — your password stays the same.', SIGN_OFF,
  ].join('\n') });
}
