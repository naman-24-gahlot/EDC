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
  registrationDecision: { by: string, at: Timestamp, note: string | null, appliedProfileType?: ProfileType } | null,
  // Set only when approved under a different type than applied for; shown once on /me, then seenAt is set.
  lastEntryAt?: Timestamp,
  lastExitAt?: Timestamp,           // last exit recorded at the gate — "on campus now" = entered today, no exit since
  emailVerified?: boolean,          // mirrors Firebase Auth after the confirmation link (or a reset link) is used
  idCheck?: { type: 'Aadhaar' | 'PAN card' | 'Driving licence' | 'Passport' | 'Voter ID' | 'College / company ID' | 'Other',
              last4: string | null, by: string, at: Timestamp, entryId: string }, // a guard saw a photo ID; never the number          // last APPROVED gate entry — written by /api/guard/verify; drives "Recently at the gate"
  approvalNotice?: { appliedAs: ProfileType, approvedAs: ProfileType, by: string, at: Timestamp, seenAt: Timestamp | null },
  onCampus?: boolean,               // last approved gate scan was an entry (entryEvents)
  lastExitAt?: Timestamp,
  backupEmail?: string,             // optional, set only by the person; also gets reset links and app emails
  // Visitor passes only (profileType 'visitor', lib/visitors.ts):
  hasAccount?: false,               // no Firebase Auth user; username "visitor-<number>" is reserved
  hostId?: string,                  // who created the pass (notified when a VVIP arrives)
  vvip?: boolean,

  accessNumber: string | null,      // 5 digits, unique across all people, stable for life. Issued at approval.
  credentialVersion: number,        // starts at 1; bump invalidates every previously issued QR

  active: boolean,                  // deactivation (disables Auth account + revokes sessions, as today)
  lastRequestAt?: Timestamp,        // written with every new access request; makes concurrent
                                    // creates for one person conflict, enforcing one PENDING
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
  retiredAccessCode: string | null, // the old full code string, now rejected at the gate
  newAccessCode: string | null,     // null only if the person had no access number yet
  credentialVersionAfter: number,
  supersededEntitlementIds: string[],
}
```

### `identifiers/{key}`
Login resolution and uniqueness. `key` is the **lowercased** identifier. One doc per
identifier per person (up to three: username, commEmail, edcEmail).
```
{ personId: string, kind: 'username' | 'commEmail' | 'edcEmail', createdAt: Timestamp }
```
Reserved **first**, in one `create()` batch under a freshly generated personId, before the
Auth account (created with that same uid) and the person doc; any later failure deletes the
reservations, so a taken username/email fails the whole registration atomically and leaves
nothing behind (since P11 — see SECURITY_MODEL.md "Email squatting"). Emails must match a
strict pattern (no `/` or whitespace) because the key is a document id. If `edcEmail` lowercases to the same string as `commEmail`,
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

Durations are **inclusive day counts** (30 days from the 1st ends on the 30th). Time windows
must satisfy `startTime < endTime` — overnight windows aren't supported. Every entitlement is
evaluated by `lib/access/evaluate.ts` only.

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
  eventId: string | null,           // the person's event when the request was made (filters)
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
  direction: 'IN' | 'OUT',          // entry or exit (exits are recorded, never refused; result 'EXITED')
  eventId: string | null,           // the person's event, if they came through one (shown to the guard)
  stayMinutes?: number | null,      // exits only: minutes since their last entry (event reports)
  timestamp: Timestamp,
}
```
An approved IN sets `people.lastEntryAt` and `people.onCampus = true`; an exit sets
`people.lastExitAt` and `onCampus = false`. "On campus now" is `onCampus == true`, so someone who
came in yesterday and never scanned out is still listed (and flagged — `stayFlags`).

### `stayFlags/{kind}_{personId}_{entryMillis}`
Stay alerts (`lib/stays.ts`), one per visit and kind — the deterministic id + `create()` makes a
second write a no-op. Never deleted; "seen" is a field.
```
{
  kind: 'LATE_EXIT' | 'OVERNIGHT' | 'MISSED_EXIT',
  personId, personName, ancestorIds: string[],   // copied from the person: parents query by ancestorIds
  entryAt: Timestamp, exitAt: Timestamp | null, minutesLate: number | null, stayMinutes: number | null,
  detail: string, eventId: string | null, createdAt: Timestamp,
  seenBy: string | null, seenAt: Timestamp | null,
}
```
LATE_EXIT = exit more than 15 min after the entitlement's `endTime`, same day. OVERNIGHT = left on
a later day, or still `onCampus` from an earlier day (noticed whenever "On campus now" loads).
MISSED_EXIT = an approved IN while still `onCampus`, an hour or more after that entry (a quick re-scan isn't one). None for entitlements with
`allowOvernight: true`. OVERNIGHT and MISSED_EXIT email the immediate parent (Masters if none).

### `holidays/{YYYY-MM-DD}`
`{ date, name, appliesTo: ProfileType[], createdBy, createdAt }` — Master only. On that date the
gate denies "Campus holiday" to the listed profile types (default: all but event_guest and visitor).
Removing one deletes the doc; the audit log keeps HOLIDAY_ADDED / HOLIDAY_REMOVED.

### `leaveRequests/{id}`
Employee leave (`lib/leave.ts`). `{ personId, personName, ancestorIds, startDate, endDate, reason,
status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', createdAt, decidedBy, decidedAt,
decisionNote }`. Approved leave never blocks the gate; the guard sees "On approved leave until …".

### `emailLog/{id}`
Every app email attempt (`lib/mail.ts`): `{ kind, personId, to, subject, status: 'sent' | 'outbox' |
'skipped' | 'failed', error, at }`. No message bodies (those exist only in `testOutbox` for `.test`).

### `auditChain/head`
`{ seq, hash, sealedAt }` — the newest sealed audit entry (`lib/auditChain.ts`).

### `events/{eventId}`
A campus event with its own time-limited registration link (SECURITY_MODEL.md "Event registration links").
```
{
  name: string, details: string, venue: string,
  accessFrom: 'YYYY-MM-DD', accessTo: 'YYYY-MM-DD',   // days approved registrants may enter
  gateOpens: 'HH:MM', gateCloses: 'HH:MM',
  linkToken: string,              // /e/<token>; replaced by "Replace link"
  linkExpiresAt: Timestamp,       // after this the link refuses registrations
  closedAt: Timestamp | null,     // closed early by a Master (reopen clears it)
  createdBy: string, createdAt: Timestamp, updatedAt: Timestamp,
}
```
Link state is computed: CLOSED if `closedAt`, EXPIRED if past `linkExpiresAt`, else OPEN.
People who registered through it carry `eventId`, `eventName` and
`registrationSource: { source, medium, campaign }` (utm tags or null) on their `people` doc.

### `emailChecks/{email}`
"Confirm your email before registering" (`lib/emailCheck.ts`). Doc id = the lower-cased email.
`{ email, requestedAt, verifiedAt | null, expiresAt | null, tokenHash?, tokenExpiresAt? }` —
confirmed for 24 h after the link is opened; `/api/register` requires it and deletes it once the
person is created (the account then starts with `emailVerified: true`). Test addresses use a hashed
one-off token (link in the outbox, valid 24 h); real addresses use Firebase's email-link sign-in.

### `testOutbox/{id}`
Emails for test addresses (domain ending `.test`) are never sent; they're filed here for the
Master's Emails page: `{ personId, to, kind, link, createdAt }` — kind is 'resetPassword' | 'verifyEmail' |
'confirmEmail', or one of the app's own mail kinds (then also `subject` and `text`, the full email).

### `passwordHashes/{personId}`
Server-only fingerprints for "the new password must differ from the old one" (SECURITY_MODEL.md
"Password reset"). Never a password; Firebase Auth keeps the real one.
```
{ current: string | null, previous: string | null, oneTime: string | null, updatedAt: Timestamp }
// each "scrypt$<salt>$<hash>" (base64url, 16-byte salt, 32-byte key)
```

### `auditLogs/{id}`
Append-only. No role may update or delete. Written **only** through `audit()` in `lib/audit.ts`,
which builds this exact shape (category from the action; the action list and groups live there
too, so filters and writer can't drift). Records from before 2026-10-22 were given `category` and
`eventId` once, additively.
```
{
  action: AuditAction,
  actorId: string,                  // personId, or 'system', or 'public' (unauthenticated registration)
  actorRole: 'master' | 'guard' | 'member' | 'system' | 'public',
  targetPersonId: string | null,    // the person the action concerns
  subjectId: string | null,         // requestId / entitlementId / entryEventId / eventId where relevant
  category: 'gate' | 'access' | 'people' | 'events' | 'security', // from the action
  eventId: string | null,           // the event the entry is about (the person's, or the event itself)
  timestamp: Timestamp,
  details: string | null,
  sealed: boolean,                  // false when written; true once chained (below)
  seq?: number, prevHash?: string, hash?: string,  // set when sealed
}
```
**Tamper-evident chain** (`lib/auditChain.ts`): shortly after an entry is written (after the
response, and before the audit page lists anything) it is sealed in a transaction on
`auditChain/head`: `seq` = next number, `hash` = HMAC-SHA256(key, prevHash | seq | the entry's
fields), key derived from `QR_TOKEN_SECRET`. "Check integrity" on the audit page recomputes every
hash. The 331 entries from before 2026-10-24 were given `sealed: false` once (additive) and sealed
in timestamp order. Categories now also include `'stays' | 'leave'`.

`AuditAction`:
`REGISTRATION_SUBMITTED | REGISTRATION_APPROVED | REGISTRATION_REJECTED | PROFILE_CREATED |
PROFILE_TYPE_CHANGED | HIERARCHY_CHANGED | MASTER_PROMOTED | MASTER_DEMOTED | GUARD_CREATED |
ACCESS_REQUEST_CREATED | ACCESS_REQUEST_APPROVED | ACCESS_REQUEST_REJECTED | ACCESS_REQUEST_EXPIRED |
ENTITLEMENT_CREATED | ENTITLEMENT_CHANGED | ENTITLEMENT_REVOKED | ENTITLEMENT_SUPERSEDED |
CREDENTIAL_REISSUED | ENTRY_APPROVED | ENTRY_DENIED | PERSON_DEACTIVATED | PERSON_REACTIVATED |
ORPHAN_AUTH_ACCOUNT_REMOVED | PROFILE_UPDATED | PASSWORD_CHANGED | PASSWORD_RESET |
SESSIONS_REVOKED | EVENT_CREATED | EVENT_UPDATED | EVENT_LINK_CLOSED | EVENT_LINK_REOPENED |
EVENT_LINK_REPLACED | EXIT_RECORDED | LATE_EXIT | OVERNIGHT_STAY | MISSED_EXIT_SCAN | STAY_FLAG_SEEN |
VISITOR_PASS_CREATED | LEAVE_REQUESTED | LEAVE_APPROVED | LEAVE_REJECTED | LEAVE_CANCELLED |
HOLIDAY_ADDED | HOLIDAY_REMOVED | APPROVAL_NOTICE_SEEN | REGISTRATION_EMAIL_CONFIRMED | SIGNED_IN |
SIGNED_OUT | TEST_DATA_CLEANED` (the authoritative list is `ACTION_GROUPS` in `lib/audit.ts`)

## State machines

### Registration (`people.registrationStatus`)
| From | To | Who | Effect |
|---|---|---|---|
| — | `PENDING` | public `/register`, or an Employee/Master creating a subordinate | person + identifiers written atomically |
| `PENDING` | `APPROVED` | Master; or the parent Employee for **their own** subordinates | approver picks the profile type (default: as applied); issues `accessNumber`, sets `active: true`, **grants the approved type's default entitlement** — one transaction (`lib/people/approveRegistration.ts`) |
| `PENDING` | `REJECTED` | same authority | person + identifiers retained |
| `REJECTED` | `APPROVED` | Master only | second chance |

Employee-created subordinates are written directly as `APPROVED` — the creator *is* their
authorized approver — and both `REGISTRATION_SUBMITTED` and `REGISTRATION_APPROVED` are audited.
Approval grants the approved type's default entitlement at once (user-requested; it used to need
a separate access request). Directly created subordinates get theirs at creation.

**Approving as a different type.** Master may pick any type; a parent Employee only the dependant
types (driver, relative, bodyguard, event guest) — they can't make someone an employee/incubee,
which would also move the person out of their tree. Hierarchy follows the type: a dependant with
no parent is placed under the approving Master; an employee/incubee becomes top-level. When the
type differs from the one applied for, `approvalNotice` is set and the person sees it once on
`/me`; `POST /api/me/notice` (self only) sets `seenAt` — the record is kept.

### Access request (`accessRequests.status`)
| From | To | Who | Effect |
|---|---|---|---|
| — | `PENDING` | the person (if `APPROVED` + `active` + no other `PENDING`), or an ancestor/Master on their behalf | `actionableUntil = now + 3d` |
| `PENDING` | `APPROVED` | Master, or any **ancestor** of `personId` (verified via `ancestorIds`) | creates an entitlement; supersedes any `ACTIVE` one |
| `PENDING` | `REJECTED` | same authority | — |
| `PENDING` | `EXPIRED` | system, computed when `now > actionableUntil`, lazily persisted | leaves queues, kept in history |

Terminal: `APPROVED`, `REJECTED`, `EXPIRED`. Never deleted.

Nobody decides a request for their **own** access — Master included. Approval runs in one
transaction: re-check `PENDING` and the deadline (if past it, `EXPIRED` is committed and the
call returns 409), grant the entitlement with `sourceRequestId` (the request's dates, then the
approver's overrides, over the profile template), set `APPROVED` + `resultingEntitlementId`.
Lazy expiry runs one small transaction per stale request, so concurrent readers expire and
audit it exactly once.

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
4. Any `ACTIVE` entitlement → `SUPERSEDED`. If that access was still in force (ACTIVE or
   SCHEDULED, not expired), a new entitlement is created in the same transaction from the **new
   type's template**, starting today (or the old start date if later): benefits follow the
   type both ways (relative 30 days → employee open-ended; employee → driver shrinks to 30
   days). Expired or no access stays that way — a type change never creates access from
   nothing. Changed from "no auto-grant" at the user's request; audited as
   `ENTITLEMENT_CREATED` "… default after type change", and the history entry records
   `grantedEntitlementId`.
5. Validation: an Employee with live subordinates cannot become a non-parent type until they
   are rehomed; a subordinate type becoming Employee/Incubee is moved to top-level; a
   top-level person can't become a subordinate type until rehomed under an employee. Masters
   and guards keep their type (demote a Master first). One transaction (`lib/people/profileType.ts`).

## Hierarchy rules
- Top-level (`parentId: null`) may only be: `employee`, `incubee`, guards, Master.
- **Only** `employee` (or Master) can be a parent. `driver`, `relative`, `bodyguard`,
  `event_guest` can never have children.
- `ancestorIds` is the root→parent chain, recomputed server-side on any parent change; depth
  is capped at 5.
- Rehoming (changing `parentId`) is Master-only, rejects cycles (new parent may not be the
  person or any descendant), and rewrites `ancestorIds` for the entire subtree.
- Master promotion/demotion is Master-only and never self-applied. Only a top-level,
  approved, active `employee` can be promoted; the last active Master can't be demoted.
- Masters and guards are always top-level and are never rehomed.

The authorization primitive built on this is documented in SECURITY_MODEL.md.
