import { NextRequest, NextResponse, after } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { nowInIST } from '@/lib/date';
import { parsePassToken, verifyPassSignature } from '@/lib/qr-token';
import { loadPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { PREFIX } from '@/lib/access/codes';
import { decideAccess, type AccessDenialReason } from '@/lib/access/evaluate';
import { getCurrentEntitlement, type Entitlement } from '@/lib/access/entitlements';
import { audit } from '@/lib/audit';
import { afterGateScan, stayFieldsAtEntry, stayFieldsAtExit, stayMinutesAt } from '@/lib/stays';
import { siteOrigin } from '@/lib/origin';
import { notifyVisitorArrived } from '@/lib/notify';
import { holidayOn } from '@/lib/holidays';
import { leaveOn } from '@/lib/leave';
import { formatDate } from '@/lib/display';
import { personTouched } from '@/lib/people/peopleIndex';

// The gate. ONE path for QR and typed code — see SECURITY_MODEL.md "Verification".
// Every verdict is recorded (entryEvent + audit) BEFORE it is returned: if recording
// fails, the guard gets an error (→ "Verification unavailable"), never an approval.

// 'Old QR (replaced)': a real pass QR from before a replacement (reissue, deactivation, revoke or
// type change) — distinct from 'Invalid QR' (not an EDC pass at all, or tampered with).
type ResolveReason = 'Invalid QR' | 'Old QR (replaced)' | 'Invalid access code' | 'Code superseded';
type Reason = ResolveReason | AccessDenialReason;

const CODE_RE = /^([A-Z]{3})(\d{5})$/;
const KNOWN_PREFIXES = new Set(Object.values(PREFIX));

/** The event a person registered through (people.eventId), or null. */
const eventOf = (p: PersonRecord | null) => (p && typeof p.eventId === 'string' ? p.eventId : null);

interface Resolved {
  person: PersonRecord | null;
  denial: ResolveReason | null;
  entitlement: Entitlement | null;
}

// As soon as we know WHO it is, the person and their entitlement are fetched together —
// one round trip instead of two on the path every gate check takes.
async function loadSubject(personId: string) {
  const [person, entitlement] = await Promise.all([loadPerson(personId), getCurrentEntitlement(personId)]);
  return { person, entitlement };
}

async function resolveToken(raw: string): Promise<Resolved> {
  const parsed = parsePassToken(raw);
  if (!parsed || !verifyPassSignature(parsed.personId, parsed.credentialVersion, parsed.signature)) {
    // Unauthenticated claim — don't attribute the attempt to whoever the token names.
    return { person: null, denial: 'Invalid QR', entitlement: null };
  }
  const { person, entitlement } = await loadSubject(parsed.personId);
  if (!person) return { person: null, denial: 'Invalid QR', entitlement: null };
  // Genuine but old (reissued / revoked / deactivated since): attributable, still denied.
  if (person.credentialVersion !== parsed.credentialVersion) return { person, denial: 'Old QR (replaced)', entitlement: null };
  return { person, denial: null, entitlement };
}

async function resolveCode(code: string): Promise<Resolved> {
  const match = code.match(CODE_RE);
  if (!match || !KNOWN_PREFIXES.has(match[1])) return { person: null, denial: 'Invalid access code', entitlement: null };
  const owner = (await adminDb.collection('accessNumbers').doc(match[2]).get()).data()?.personId;
  if (typeof owner !== 'string') return { person: null, denial: 'Invalid access code', entitlement: null };
  const { person, entitlement } = await loadSubject(owner);
  if (!person || !person.profileType) return { person: null, denial: 'Invalid access code', entitlement: null };
  if (PREFIX[person.profileType] !== match[1]) return { person, denial: 'Code superseded', entitlement: null };
  return { person, denial: null, entitlement };
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'guard') return NextResponse.json({ error: 'Guards only.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token.trim() : null;
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : null;
  if (!token === !code || (token && token.length > 512) || (code && code.length > 32)) {
    return NextResponse.json({ error: 'Send exactly one of { token } or { code }.' }, { status: 400 });
  }
  const method = token ? 'QR' : 'CODE';
  // Exits are recorded, never refused: we identify who is leaving, but nobody is kept in.
  const direction: 'IN' | 'OUT' = body?.direction === 'OUT' ? 'OUT' : 'IN';

  const today = nowInIST();
  try {
    const [{ person, denial, entitlement }, holiday] = await Promise.all([token ? resolveToken(token) : resolveCode(code!), holidayOn(today.date)]);

    let approved = false;
    let reason: Reason | null = denial;
    let entitlementId: string | null = null;
    // An exit only needs to know who it is: a replaced-QR or superseded-code still identifies them.
    const exit = direction === 'OUT' && !!person;
    if (exit) {
      approved = true;
      reason = null;
    } else if (person && !denial) {
      const decision = decideAccess(person, entitlement, today, holiday);
      approved = decision.allowed;
      reason = decision.reason;
      entitlementId = decision.entitlement?.id ?? null;
    }

    const now = Timestamp.now();
    const eventRef = adminDb.collection('entryEvents').doc();
    const batch = adminDb.batch();
    batch.create(eventRef, {
      personId: person?.personId ?? null,
      entitlementId,
      guardUid: user.personId,
      method,
      direction,
      result: exit ? 'EXITED' : approved ? 'APPROVED' : 'DENIED',
      reason,
      presentedCode: method === 'CODE' ? code : null, // the QR token itself is never stored
      eventId: eventOf(person),
      timestamp: now,
      // Exits: minutes since their entry, when we have one (event reports, stay alerts).
      ...(exit ? { stayMinutes: stayMinutesAt(person!, now) } : {}),
    });
    // lastEntryAt / lastExitAt / onCampus drive "Recently at the gate" and "On campus now" without scanning entries;
    // the stay fields let the headcount and overnight check skip the access records (lib/stays.ts).
    if (approved && person) {
      batch.update(adminDb.collection('people').doc(person.personId), exit
        ? { lastExitAt: now, onCampus: false, ...stayFieldsAtExit(), ...personTouched() }
        : { lastEntryAt: now, onCampus: true, ...stayFieldsAtEntry(entitlement, now), ...personTouched() });
    }
    audit(batch, {
      action: exit ? 'EXIT_RECORDED' : approved ? 'ENTRY_APPROVED' : 'ENTRY_DENIED', actor: user, targetPersonId: person?.personId ?? null,
      subjectId: eventRef.id, eventId: eventOf(person), at: now, details: reason ? `${method}: ${reason}` : method,
    });
    await batch.commit();

    // After the answer: late / overnight / missed-exit checks, and "your VVIP visitor has arrived".
    if (approved && person) {
      afterGateScan(person, entitlement, direction, now, await siteOrigin());
      if (!exit && person.profileType === 'visitor' && person.vvip === true) after(() => notifyVisitorArrived(person.personId).then(() => {}, (e) => console.error('Arrival email failed', e)));
    }

    // Things the guard should know about who's in front of them (never change the verdict).
    const notes: string[] = [];
    if (person && reason === 'Campus holiday' && holiday) notes.push(`Holiday: ${holiday.name}`);
    if (person?.profileType === 'visitor') {
      const host = typeof person.hostId === 'string' ? await loadPerson(person.hostId) : null;
      notes.push(`${person.vvip ? 'VVIP visitor' : 'Visitor'}${host ? ` of ${host.firstName} ${host.lastName}` : ''}${person.vvip ? ' — escort them; their host has been told' : ''}`);
    }
    if (approved && !exit && person?.profileType === 'employee') {
      const leave = await leaveOn(person.personId, today.date).catch(() => null);
      if (leave) notes.push(`On approved leave until ${formatDate(leave.endDate)}`);
    }

    const idCheck = person?.idCheck as { type?: string; last4?: string | null; at?: Timestamp } | undefined;
    return NextResponse.json({
      approved,
      reason,
      direction,
      exit,
      // The guard may record "photo ID seen" against THIS gate record (POST /api/guard/id-check).
      entryId: approved && !exit ? eventRef.id : null,
      notes,
      idCheck: person ? (idCheck?.type ? { type: idCheck.type, last4: idCheck.last4 ?? null, at: idCheck.at?.toDate().toISOString() ?? null } : null) : null,
      person: person
        ? {
            name: `${person.firstName} ${person.lastName}`,
            profileType: person.profileType,
            photoDataUrl: typeof person.photoDataUrl === 'string' ? person.photoDataUrl : null,
            // Event guests: the guard sees which event they are here for.
            eventName: eventOf(person) ? String(person.eventName ?? 'Event') : null,
            vvip: person.vvip === true,
          }
        : null,
    });
  } catch (err) {
    console.error('Gate verification failed', err);
    return NextResponse.json({ error: 'Verification unavailable' }, { status: 503 });
  }
}
