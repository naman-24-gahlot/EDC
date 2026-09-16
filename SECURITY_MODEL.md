# Security Model

Supersedes the daily-permission model. The previous model's design history, its live audit
(Session 8) and its deployment fixes are preserved in PROGRESS.md; this file describes the
current target. Schema: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

## Core pattern: routes own every read and write
The Firebase Admin SDK bypasses Firestore security rules by design. This project leans into
that rather than fighting it:

1. **`firestore.rules` denies all client access — reads and writes — on every collection.**
   The app never uses the client Firestore SDK. The rules file exists as defence in depth
   against anyone using the public Firebase config to talk to Firestore directly; it is not
   part of the authorization model.
2. **Every read and every mutation goes through a Next.js Route Handler or Server Component**
   that resolves the caller from the verified session cookie (`lib/session.ts`) and checks
   authority server-side before touching Firestore.
3. A review of "can X do Y" is therefore a review of one Route Handler, not a reconciliation
   of client code against a rules file.

## Identity and login
- One Firebase Auth account per person, keyed on the **communication email** exactly as
  entered. `personId == uid`.
- Three login identifiers — username, EDC institutional email, communication email — all
  resolve to that one account via `identifiers/{lowercased}` docs. No duplicate accounts,
  ever.
- **Login is verified server-side.** The login page posts `{ identifier, password }` to a
  Route Handler which: resolves the identifier to a `personId` via Firestore; verifies the
  password against Firebase Auth's REST `signInWithPassword` endpoint (using the public web
  API key — no new secret); then issues the same httpOnly `SameSite=Lax` session cookie as
  before via `createSessionCookie`. The canonical email **never leaves the server**, and the
  response is identical for "unknown identifier" and "wrong password" — no enumeration oracle.
- The EDC email is `${username}@${EDC_EMAIL_DOMAIN}`. If the env var is unset the identifier
  is simply not assigned; login via the other two still works. No domain is ever invented.
- Passwords are only ever handled by Firebase Auth. Nothing in this codebase stores or logs
  one.

## Two authorization axes — and why role alone is never enough
- **`systemRole`** (`master | guard | member`) lives in the Firebase **custom claim** and is
  the only thing route-level gating reads. It answers "may this kind of account reach this
  area at all?" Set only by the seed script or a Master-only promotion route. Never
  self-assignable. Never read from a request body.
- **`profileType`** (employee / incubee / event_guest / driver / relative / bodyguard) lives
  on the person doc and drives entitlement templates, the access-code prefix, and who may be
  a parent. It is **not** an authorization role.
- **Hierarchy** is the third input, and for anything that acts on *another* person it is the
  deciding one. See below.

## Hierarchical authorization
One server-side primitive, used by every Route Handler that reads, lists, approves, rejects,
revokes, edits or otherwise acts on a person other than the caller:

```
assertCanActOn(actor, target):
  allowed iff  actor.systemRole === 'master'
           or  actor.personId ∈ target.ancestorIds
```

Nothing else grants authority. Specifically:
- Being an `employee` grants nothing by itself — Employee 1 has authority over Employee 1's
  descendants only, because their `personId` appears in those descendants' `ancestorIds`.
- Self is not authority: you cannot approve your own request or registration.
- Listing "people under me" is a server-side `array-contains` on `ancestorIds`, never a
  client-side filter of a broader list.
- The following are **never** trusted from the client, in any route: role, systemRole,
  parentId, employeeId, personId-of-target-as-authority, hierarchy scope, approval authority,
  ownership. The target is loaded from Firestore and its `ancestorIds` is what's checked.
- `ancestorIds` is written only by the server on registration/subordinate creation and on
  Master-only rehoming, with cycle and depth checks. A client cannot alter its own or anyone
  else's hierarchy position.

## Registration and approval authority
- Public `/register` is unauthenticated; it can only create a `PENDING` person. Approval is
  the gate, so a public link is acceptable and tokenised invites are not needed.
- Approving/rejecting a registration: Master anywhere; otherwise only the person named as
  parent, and only if that parent is an approved, active `employee`.
- An Employee creating a subordinate is that subordinate's approver, so the profile is
  written `APPROVED` directly — with both `REGISTRATION_SUBMITTED` and `REGISTRATION_APPROVED`
  audited under the Employee's `actorId`. Employees may only create `driver`, `relative`,
  `bodyguard`, `event_guest`. Employees and Incubees arrive via public registration and are
  approved by Master.
- Guards are created by Master only. Master is granted only by promotion by an existing
  Master; the very first Master is created by the seed script, out of band.

## Access credential (QR + human-readable code)

### Design
```
token     = `${personId}.${credentialVersion}.${signature}`
signature = HMAC-SHA256(`${personId}.${credentialVersion}`, QR_TOKEN_SECRET) → hex
```
The credential is bound to the **person and a version**, not to a request or a day. It is
**reusable**: nothing about a successful scan changes the token or the person's version. It
stops working only when the entitlement no longer permits entry, or when the version is
bumped (revocation, profile-type change, explicit reissue, deactivation), which invalidates
every previously issued QR at once.

The human-readable code (`PREFIX + accessNumber`, e.g. `EDC25166`) is **not a secret and not
a bypass**. It is a lookup key that reaches the *same* evaluation as the QR. Its security is
that the evaluation happens server-side against the person's live state, exactly as for the
QR; the code merely identifies the person to evaluate. Anyone typing a valid code at the
gate is subject to the same entitlement, day, hour and revocation checks.

### Verification — `POST /api/guard/verify` — one path for both methods
Requires `systemRole === 'guard'`. Accepts `{ token }` **or** `{ code }`. Steps, first
failure wins, every outcome appends an `entryEvent` and an audit entry:

1. Resolve to a person.
   - QR: split on `.`, exactly 3 parts; recompute the HMAC and compare with
     `crypto.timingSafeEqual`; load the person; the signed version must equal
     `person.credentialVersion` → else **"Invalid QR"**.
   - Code: 3 letters + 5 digits; `accessNumbers/{digits}` → person; if
     `PREFIX[person.profileType] !== prefix` → **"Code superseded"**; unknown → **"Invalid access code"**.
2. `!person.active` → **"Access revoked"**.
3. `registrationStatus !== 'APPROVED'` → **"Registration not approved"**.
4. No `ACTIVE` entitlement → **"No active access"**.
5. Effective status `REVOKED` → **"Access revoked"**; `EXPIRED` → **"Access expired"**;
   `SCHEDULED` → **"Access not yet active"**.
6. Today's weekday ∉ `weekdays` → **"Outside permitted days"**.
7. Now ∉ `[startTime, endTime)` → **"Outside permitted hours"**.
8. **ENTRY APPROVED.** Append `entryEvent { result: 'APPROVED' }`. Nothing else changes.

Steps 2–8 are one function, `evaluateAccess(person, now)`, in `lib/access/`. The gate route
and the person's own pass screen both use it; there is no second implementation.

### What the Guard is shown
Name, photo thumbnail, profile type, verdict, and the denial reason. **Never**: contact
details, hierarchy, entitlement dates/hours, access code (when scanning a QR), or anything
about other people.

### Fail-safe
If the verification request fails for any reason other than an explicit verdict — network,
server, database — the Guard UI shows **"Verification unavailable"** and never a green
result. There is no offline mode and the UI must not imply one. The architecture leaves room
for a future signed-offline-manifest scheme if the college asks, but nothing here pretends to
be it.

## Time-based state without a cron
Spark tier has no Cloud Functions, so nothing runs on a schedule. All time-dependent state is
**computed at read/verify time** from stored dates against IST "now" (`lib/date.ts`):
- entitlement `EXPIRED` / `SCHEDULED`
- request `EXPIRED` (past `actionableUntil`) — additionally **lazily persisted** when a queue
  reads it or a write touches it, so history shows the terminal status without a job.
This is correct-by-construction: a request can't be approved a second late because the
approve route recomputes expiry inside its transaction before acting.

## Threats explicitly defended against
- **Role spoofing** — role/systemRole only ever come from the verified session's claim.
- **Cross-hierarchy access (Employee 1 → Employee 2's people)** — every cross-person route
  calls `assertCanActOn`; listings are `ancestorIds` queries, not filtered client lists.
- **Self-promotion to Master / hierarchy tampering** — promotion and rehoming are
  Master-only routes; `ancestorIds`/`parentId` are server-written only; cycle-checked.
- **Cross-person data read** — client Firestore access is denied entirely; every server
  read is scoped by session identity or `assertCanActOn`.
- **QR forgery** — needs the HMAC secret, which never leaves the server. Constant-time compare.
- **QR replay / stale QR** — a real scan is *meant* to be replayable while access is valid;
  what is prevented is use *after* revocation/type change/deactivation, via the version bump.
- **Code guessing** — the code is a lookup key only; guessing a valid one still yields a
  full entitlement evaluation for that person, exactly as if they'd scanned. The 90,000-value
  space per prefix is small on purpose (memorability) and is not relied on for security.
- **Out-of-hours / expired / revoked / not-yet-active use** — steps 4–7 above, evaluated
  live from server time on every attempt.
- **Direct Route Handler calls** — every handler re-derives the actor from the session cookie
  and re-checks authority; the UI hides nothing that the server doesn't also refuse.
- **Direct Firestore access with the public config** — rules deny all client reads/writes;
  verified live with the client SDK in the Session 8 audit and to be re-verified in P11.
- **Secrets in the repo** — `.env.local`, credentials files gitignored; `.env.example` is
  names only; no secret is ever printed by a script or logged by a route.
- **Username / email enumeration via login** — server-side verification returns the same
  generic failure for unknown identifier and wrong password.

## Intentionally out of scope for this release
Government-ID / Aadhaar verification, biometrics, external identity providers, rate limiting
and brute-force login protection (Firebase Auth's own defaults apply), MFA, offline gate
verification. The identity model keeps `people` and the future verification concern
separate so an external verification module can attach to a person later without redesign.

## Firestore rules — deployment
Rules are in `firestore.rules`; deploy with `firebase deploy --only firestore:rules`
(the CLI is already authenticated on this machine from earlier sessions; a phase that needs
this will attempt it and report if it can't).
