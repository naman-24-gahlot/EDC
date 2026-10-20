import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { nowInIST } from '@/lib/date';
import { parsePassToken, verifyPassSignature } from '@/lib/qr-token';
import { loadPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { PREFIX } from '@/lib/access/codes';
import { decideAccess, type AccessDenialReason } from '@/lib/access/evaluate';
import { getCurrentEntitlement, type Entitlement } from '@/lib/access/entitlements';

// The gate. ONE path for QR and typed code — see SECURITY_MODEL.md "Verification".
// Every verdict is recorded (entryEvent + audit) BEFORE it is returned: if recording
// fails, the guard gets an error (→ "Verification unavailable"), never an approval.

type ResolveReason = 'Invalid QR' | 'Invalid access code' | 'Code superseded';
type Reason = ResolveReason | AccessDenialReason;

const CODE_RE = /^([A-Z]{3})(\d{5})$/;
const KNOWN_PREFIXES = new Set(Object.values(PREFIX));

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
  if (person.credentialVersion !== parsed.credentialVersion) return { person, denial: 'Invalid QR', entitlement: null };
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

  try {
    const { person, denial, entitlement } = token ? await resolveToken(token) : await resolveCode(code!);

    let approved = false;
    let reason: Reason | null = denial;
    let entitlementId: string | null = null;
    if (person && !denial) {
      const decision = decideAccess(person, entitlement, nowInIST());
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
      result: approved ? 'APPROVED' : 'DENIED',
      reason,
      presentedCode: method === 'CODE' ? code : null, // the QR token itself is never stored
      timestamp: now,
    });
    batch.set(adminDb.collection('auditLogs').doc(), {
      action: approved ? 'ENTRY_APPROVED' : 'ENTRY_DENIED',
      actorId: user.personId,
      actorRole: user.systemRole,
      targetPersonId: person?.personId ?? null,
      subjectId: eventRef.id,
      timestamp: now,
      details: reason ? `${method}: ${reason}` : method,
    });
    await batch.commit();

    return NextResponse.json({
      approved,
      reason,
      person: person
        ? {
            name: `${person.firstName} ${person.lastName}`,
            profileType: person.profileType,
            photoDataUrl: typeof person.photoDataUrl === 'string' ? person.photoDataUrl : null,
          }
        : null,
    });
  } catch (err) {
    console.error('Gate verification failed', err);
    return NextResponse.json({ error: 'Verification unavailable' }, { status: 503 });
  }
}
