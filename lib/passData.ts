// SERVER-ONLY. What goes on a person's printed pass (lib/passCard.ts draws it), and who may print it:
// the person, anyone they're under, a Master (assertCanActOn) — or whoever holds their pass link
// (the credential itself, as on /v/<token>: that's how a kiosk prints a pass for someone with no
// account). The QR printed is the same reusable credential the gate checks: replacing someone's
// QR (or revoking / deactivating) makes printed cards stop working — reprint them.
if (typeof window !== 'undefined') {
  throw new Error('lib/passData.ts must never be imported into client code.');
}

import QRCode from 'qrcode';
import { todayDateString } from '@/lib/date';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, loadPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { accessCodeFor } from '@/lib/access/codes';
import { effectiveStatus, getCurrentEntitlement } from '@/lib/access/entitlements';
import { passTokenFor } from '@/lib/access/credential';
import { parsePassToken, verifyPassSignature } from '@/lib/qr-token';
import { daysLabel, formatDate } from '@/lib/display';
import { roleKey, type CardData } from '@/lib/passCard';

const name = async (id: unknown) => { const p = typeof id === 'string' ? await loadPerson(id) : null; return p ? `${p.firstName} ${p.lastName}` : null; };

export async function cardDataFor(person: PersonRecord): Promise<CardData> {
  const today = todayDateString();
  const ent = await getCurrentEntitlement(person.personId);
  const status = ent ? effectiveStatus(ent, today) : null;
  const live = person.registrationStatus === 'APPROVED' && person.active === true && (status === 'ACTIVE' || status === 'SCHEDULED');
  const validity = live && ent
    ? `Valid ${ent.endDate ? `${formatDate(ent.startDate)} – ${formatDate(ent.endDate)}` : `from ${formatDate(ent.startDate)}`} · ${daysLabel(ent.weekdays)} ${ent.startTime}–${ent.endTime}`
    : 'No access in force — the gate checks live';
  // One line under the name: who they're visiting, their event, who they're under, or their role's purpose.
  let sub: string | null = null;
  if (person.profileType === 'visitor') { const h = await name(person.hostId); sub = h ? `Visiting ${h}` : null; }
  else if (person.profileType === 'event_guest' && typeof person.eventName === 'string') sub = person.eventName;
  else if (person.parentId) { const p = await name(person.parentId); sub = p ? `Under ${p}` : null; }
  else if (typeof person.purpose === 'string' && person.systemRole !== 'master') sub = person.purpose;

  let qr: CardData['qr'] = null;
  if (live) {
    const m = QRCode.create(passTokenFor(person), { errorCorrectionLevel: 'M' }).modules;
    const cells: number[] = [];
    for (let i = 0; i < m.data.length; i++) if (m.data[i]) cells.push(i);
    qr = { size: m.size, cells };
  }
  return {
    name: `${person.firstName} ${person.lastName}`,
    role: roleKey({ systemRole: person.systemRole, profileType: person.profileType, vvip: person.vvip === true }),
    subtitle: sub,
    code: accessCodeFor(person.profileType, person.accessNumber),
    validity,
    photo: typeof person.photoDataUrl === 'string' ? person.photoDataUrl : null,
    qr,
    issued: `Issued ${formatDate(today)}`,
  };
}

/** The person whose pass may be printed: by pass link (`token`), or by a signed-in viewer allowed to. */
export async function printablePerson(input: { user: SessionUser | null; personId?: string | null; token?: string | null }): Promise<PersonRecord> {
  if (input.token) {
    const parsed = parsePassToken(input.token);
    if (!parsed || !verifyPassSignature(parsed.personId, parsed.credentialVersion, parsed.signature)) throw new HttpError(404, 'This pass link isn’t valid.');
    const person = await loadPerson(parsed.personId);
    if (!person || person.credentialVersion !== parsed.credentialVersion) throw new HttpError(404, 'This pass was replaced — ask for the new one.');
    return person;
  }
  if (!input.user) throw new HttpError(401, 'Sign in to print a pass.');
  const id = input.personId || input.user.personId;
  const person = id === input.user.personId ? await loadPerson(id) : await assertCanActOn(input.user, id);
  if (!person) throw new HttpError(404, 'Person not found.');
  if (!person.profileType && person.systemRole !== 'master') throw new HttpError(400, 'Guards don’t have an entry pass.');
  return person;
}
