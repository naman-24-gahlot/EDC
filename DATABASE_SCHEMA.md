# Database Schema — Firestore

Supersedes the daily-permission model (Sessions 1–10; see PROGRESS.md). All writes happen
server-side via Route Handlers using the Firebase Admin SDK. The client Firestore SDK is
**not used for reads at all** — rules deny all client access (see SECURITY_MODEL.md).

Conventions used throughout:
- `personId` **is** the Firebase Auth `uid`. One person = one Auth account, always.
- Dates are `YYYY-MM-DD` and times are `HH:MM` (24h), both in **IST** (`lib/date.ts`).
- Weekdays use the JS convention: `0 = Sunday … 6 = Saturday`.
- Time windows are start-inclusive, end-exclusive: `09:00–17:00` allows `09:00`, denies `17:00`.
- "Computed" states are never stored; they're derived at read/verify time. There is no
  cron (Spark tier, no Cloud Functions), so anything time-based is evaluated on demand.
- Uniqueness is enforced with **deterministic document IDs + `create()`**, which fails
  atomically if the doc exists — the same trick the old model used for one-request-per-day.

## Collections

### `people/{personId}`
The person: identity, current profile, hierarchy position, credential state.

```
{
  personId: string,                 // == Firebase Auth uid == doc id
  firstName: string,
  lastName: string,
  username: string,                 // lowercased, [a-z0-9._-]{3,30} — can never contain '@'
  commEmail: string,                // exactly as entered; the Firebase Auth account email
  edcEmail: string | null,          // `${username}@${EDC_EMAIL_DOMAIN}`; null until the domain is configured
  mobile: string,
  photoDataUrl: string | null,      // client-downscaled ~256px JPEG data URL (no Firebase Storage)
  purpose: string,                  // "Profile / Purpose" free text from registration

  profileType: 'employee' | 'incubee' | 'event_guest' | 'driver' | 'relative' | 'bodyguard' | null,
                                    // null ONLY for guards — Guard is a system role, not a profile
  systemRole: 'master' | 'guard' | 'member',
                                    // mirrors the custom claim; authorization reads the CLAIM, this is display

  parentId: string | null,          // null = top-level (directly under Master)
  ancestorIds: string[],            // root → parent chain, maintained server-side. [] for top-level.

  registrationStatus: 'PENDING' | 'APPROVED' | 'REJECTED',
  registrationDecision: { by: string, at: Timestamp, note: string | null } | null,

  accessNumber: string | null,      // 5 digits, unique across all people, stable for life. Issued at approval.
  credentialVersion: number,        // starts at 1; bump invalidates every previously issued QR

  active: boolean,                  // deactivation (disables Auth account + revokes sessions, as today)
  createdAt: Timestamp,
  createdBy: string,                // personId of creator, or 'self' for public registration
}
```

The current human-readable **access code is derived**, not stored:
`accessCode = PREFIX[profileType] + accessNumber`. Prefixes: employee `EDC`, incubee `INC`,
event_guest `GUE`, driver `DRV`, relative `REL`, bodyguard `BDG`. Master and guards have no code.

### `people/{personId}/profileHistory/{id}`
Append-only. One entry per profile-type change.
```
{
  fromProfileType, toProfileType,
  changedBy: string, changedAt: Timestamp, reason: string | null,
  retiredAccessCode: string,        // the old full code string, now rejected at the gate
  newAccessCode: string,
  credentialVersionAfter: number,
}
```

### `identifiers/{key}`
Login resolution and uniqueness. `key` is the **lowercased** identifier. One doc per
identifier per person (up to three: username, commEmail, edcEmail).
```
{ personId: string, kind: 'username' | 'commEmail' | 'edcEmail', createdAt: Timestamp }
```
Written in the same batch as the person doc with `create()`, so a taken username/email fails
the whole registration atomically. If `edcEmail` lowercases to the same string as `commEmail`,
only one doc is written. Usernames can't collide with emails (no `@` allowed).

### `accessNumbers/{fiveDigits}`
Digit uniqueness across all people, and the gate's lookup path for typed codes.
```
{ personId: string, issuedAt: Timestamp }
```
Gate flow for a typed code: split into 3-letter prefix + 5 digits → look up this doc → load the
person → if `PREFIX[person.profileType] !== prefix` the code is **superseded** (person changed
profile type). No retired-codes table is needed.

### `entitlements/{id}`
A granted access period. **At most one `ACTIVE` per person at a time.**
```
{
  personId: string,
  profileTypeAtGrant: ProfileType,
  startDate: string,                // YYYY-MM-DD
  endDate: string | null,           // null = open-ended (until revoked/superseded)
  weekdays: number[],               // JS 0–6
  startTime: string,                // HH:MM
  endTime: string,                  // HH:MM, exclusive
  state: 'ACTIVE' | 'REVOKED' | 'SUPERSEDED',
  sourceRequestId: string | null,   // null = Master granted directly
  approvedBy: string, approvedAt: Timestamp,
  revokedBy: string | null, revokedAt: Timestamp | null, revokeReason: string | null,
  createdAt: Timestamp,
}
```
**Computed effective status** (never stored): if `state !== 'ACTIVE'` → that state; else if
`today > endDate` → `EXPIRED`; else if `today < startDate` → `SCHEDULED`; else `ACTIVE`.

Default templates, applied at approval and editable by the approver:

| Profile | Weekdays | Hours | Duration |
|---|---|---|---|
| employee | Mon–Fri | 09:00–17:00 | open-ended |
| incubee | Mon–Fri | 09:00–17:00 | 90 days |
| event_guest | Mon–Sun | 09:00–18:00 | approver-set (default 2 days) |
| driver / relative / bodyguard | Mon–Sat | 08:00–20:00 | 30 days |

### `accessRequests/{id}`
A request to obtain or renew an entitlement. **At most one `PENDING` per person at a time.**
```
{
  personId: string,                 // who needs access
  requestedBy: string,              // personId — self, or an ancestor on their behalf
  purpose: string,
  requestedStartDate: string | null,
  requestedEndDate: string | null,
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED',
  createdAt: Timestamp,
  actionableUntil: Timestamp,       // createdAt + 3 days
  decidedBy: string | null, decidedAt: Timestamp | null, decisionNote: string | null,
  resultingEntitlementId: string | null,
  expiredMarkedAt: Timestamp | null, // when lazy expiry persisted the EXPIRED status
}
```
`EXPIRED` is computed (`now > actionableUntil` while `PENDING`) and **lazily persisted** the
next time the doc is read by a queue or touched by a write. Expired requests leave pending
queues but are never deleted — they stay in history with their audit trail.

### `entryEvents/{id}`
Append-only. **Every** gate attempt, approved or denied. Entering does not consume anything.
```
{
  personId: string | null,          // null when the credential didn't resolve to anyone
  entitlementId: string | null,
  guardUid: string,
  method: 'QR' | 'CODE',
  result: 'APPROVED' | 'DENIED',
  reason: DenialReason | null,      // see SECURITY_MODEL.md
  presentedCode: string | null,     // CODE method only. The QR token is NEVER stored.
  timestamp: Timestamp,
}
```

### `auditLogs/{id}`
Append-only. No role may update or delete.
```
{
  action: AuditAction,
  actorId: string,                  // personId, or 'system', or 'public' (unauthenticated registration)
  actorRole: 'master' | 'guard' | 'member' | 'system' | 'public',
  targetPersonId: string | null,    // the person the action concerns
  subjectId: string | null,         // requestId / entitlementId / entryEventId where relevant
  timestamp: Timestamp,
  details: string | null,
}
```
`AuditAction`:
`REGISTRATION_SUBMITTED | REGISTRATION_APPROVED | REGISTRATION_REJECTED | PROFILE_CREATED |
PROFILE_TYPE_CHANGED | HIERARCHY_CHANGED | MASTER_PROMOTED | MASTER_DEMOTED | GUARD_CREATED |
ACCESS_REQUEST_CREATED | ACCESS_REQUEST_APPROVED | ACCESS_REQUEST_REJECTED | ACCESS_REQUEST_EXPIRED |
ENTITLEMENT_CREATED | ENTITLEMENT_CHANGED | ENTITLEMENT_REVOKED | ENTITLEMENT_SUPERSEDED |
CREDENTIAL_REISSUED | ENTRY_APPROVED | ENTRY_DENIED | PERSON_DEACTIVATED | PERSON_REACTIVATED`

## State machines

### Registration (`people.registrationStatus`)
| From | To | Who | Effect |
|---|---|---|---|
| — | `PENDING` | public `/register`, or an Employee/Master creating a subordinate | person + identifiers written atomically |
| `PENDING` | `APPROVED` | Master; or the parent Employee for **their own** subordinates | issues `accessNumber`, sets `active: true` |
| `PENDING` | `REJECTED` | same authority | person + identifiers retained |
| `REJECTED` | `APPROVED` | Master only | second chance |

Employee-created subordinates are written directly as `APPROVED` — the creator *is* their
authorized approver — and both `REGISTRATION_SUBMITTED` and `REGISTRATION_APPROVED` are audited.
Approval never grants an entitlement; that is a separate access request.

### Access request (`accessRequests.status`)
| From | To | Who | Effect |
|---|---|---|---|
| — | `PENDING` | the person (if `APPROVED` + `active` + no other `PENDING`), or an ancestor/Master on their behalf | `actionableUntil = now + 3d` |
| `PENDING` | `APPROVED` | Master, or any **ancestor** of `personId` (verified via `ancestorIds`) | creates an entitlement; supersedes any `ACTIVE` one |
| `PENDING` | `REJECTED` | same authority | — |
| `PENDING` | `EXPIRED` | system, computed when `now > actionableUntil`, lazily persisted | leaves queues, kept in history |

Terminal: `APPROVED`, `REJECTED`, `EXPIRED`. Never deleted.

### Entitlement (`entitlements.state` + computed)
| From | To | Who | Effect |
|---|---|---|---|
| — | `ACTIVE` | request approval, or Master direct grant | any existing `ACTIVE` → `SUPERSEDED` |
| `ACTIVE` | `REVOKED` | Master, or an ancestor of the person | `credentialVersion++` on the person |
| `ACTIVE` | `SUPERSEDED` | system (new grant, or profile-type change) | — |
| `ACTIVE` | `ACTIVE` (edited window/hours) | Master, or an ancestor | audited; **no** version bump — QR is person-bound, rules are evaluated live |
| computed | `EXPIRED` / `SCHEDULED` | — | from `endDate` / `startDate` vs today |

### Credential (no stored state)
A QR token is valid iff its HMAC verifies **and** the signed `credentialVersion` equals the
person's current one. `credentialVersion` is bumped by: revocation, profile-type change,
explicit reissue, deactivation. It is **not** bumped by editing entitlement hours/dates or by
being scanned — the same pass keeps working for entry 1…n while the entitlement allows it.

### Profile-type change (Master only)
1. `profileHistory` entry written, including the old full code string.
2. Prefix changes, `accessNumber` stays → old code string is rejected at the gate as superseded.
3. `credentialVersion++` → every old QR dies.
4. Any `ACTIVE` entitlement → `SUPERSEDED`. **No auto-grant** — Master grants a fresh one under
   the new type's template. (Silently auto-granting access on a type change is the wrong
   default for an access-control system; it's a one-line change if the college wants it.)
5. Validation: an Employee with live subordinates cannot become a non-parent type until they
   are rehomed; a subordinate type becoming Employee/Incubee is moved to top-level.

## Hierarchy rules
- Top-level (`parentId: null`) may only be: `employee`, `incubee`, guards, Master.
- **Only** `employee` (or Master) can be a parent. `driver`, `relative`, `bodyguard`,
  `event_guest` can never have children.
- `ancestorIds` is the root→parent chain, recomputed server-side on any parent change; depth
  is capped at 5.
- Rehoming (changing `parentId`) is Master-only, rejects cycles (new parent may not be the
  person or any descendant), and rewrites `ancestorIds` for the entire subtree.
- Master promotion/demotion is Master-only and never self-applied.

The authorization primitive built on this is documented in SECURITY_MODEL.md.
