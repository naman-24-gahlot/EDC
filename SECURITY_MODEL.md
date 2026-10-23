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

## Implementation notes (`lib/hierarchy/`)
- `assertCanActOn` additionally requires a non-Master actor's own profile to be `APPROVED`
  and `active` (pending people can sign in, but have no authority). This only narrows the rule.
- For non-Masters a nonexistent target returns 403, not 404, so ids can't be probed.
- Masters and guards are always top-level and can't be rehomed; a person can only be promoted
  if they are a top-level, approved, active `employee` — so no one is ever above a Master.
- Promotion/demotion and deactivation call `revokeRefreshTokens`, so the change takes effect
  on already-open sessions (they're bounced to sign in again and get the new claim).
- Rehoming and demotion run in Firestore transactions: concurrent rehomes can't corrupt a
  subtree's `ancestorIds`, and two Masters demoting each other at once leaves exactly one
  (verified live).
- Reactivation requires `APPROVED`, since `PENDING`/`REJECTED` people are also `active: false`
  and reactivating them would bypass approval.

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

Implementation (`lib/qr-token.ts`, `lib/access/credential.ts`): `parsePassToken` rejects
anything but `[A-Za-z0-9]+ . positive-integer . 64 lowercase hex` before any HMAC work;
`reissueCredential` may be called by the person themselves (lost phone, leaked screenshot),
Master, or an ancestor, and is audited `CREDENTIAL_REISSUED`. The pass page computes the token
server-side on every render and only renders a QR while the entitlement is effectively ACTIVE.

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
     `person.credentialVersion`. Bad signature / unknown person → **"Invalid QR"**; genuine but
     outdated version (QR replaced, deactivated, revoked, type changed) → **"Old QR (replaced)"**.
   - Code: 3 letters + 5 digits; `accessNumbers/{digits}` → person; if
     `PREFIX[person.profileType] !== prefix` → **"Code superseded"**; unknown → **"Invalid access code"**.
2. `registrationStatus !== 'APPROVED'` → **"Registration not approved"**.
3. `!person.active` → **"Account deactivated"** (distinct from an access period being revoked). (Registration is checked first because `PENDING`
   people are also `active: false`; the order changes only the reason, never the verdict.)
4. No `ACTIVE` entitlement → **"No active access"**.
5. Effective status `REVOKED` → **"Access revoked"**; `EXPIRED` → **"Access expired"**;
   `SCHEDULED` → **"Access not yet active"**.
6. Today's weekday ∉ `weekdays` → **"Outside permitted days"**.
7. Now ∉ `[startTime, endTime)` → **"Outside permitted hours"**.
8. **ENTRY APPROVED.** Append `entryEvent { result: 'APPROVED' }`. Nothing else changes.

Steps 2–8 are one function, `evaluateAccess(person, now)`, in `lib/access/`. The gate route
and the person's own pass screen both use it; there is no second implementation.

Implementation notes (`app/api/guard/verify`, Expansion P8):
- **Record, then respond.** The `entryEvent` and audit entry are committed in one batch
  *before* the verdict is returned; if that write fails the response is 503, so an approval is
  never given that isn't on record.
- **Attribution.** A token whose signature fails is logged with `personId: null` (the claimed
  id is unauthenticated). A genuine but outdated token (version bumped) is logged against its
  person, denied "Old QR (replaced)". "Code superseded" is attributed too. The guard screen shows
  a one-line "what to do" for every reason (`GUIDANCE` in `app/guard/GuardScanner.tsx`).
- Codes are trimmed and upper-cased; an unknown prefix is "Invalid access code", a known
  prefix that isn't the person's current one is "Code superseded".
- The scanner pauses ~3s after each scan and ignores the same QR for 8s: a reusable pass held
  in front of the camera would otherwise be verified (and logged) many times a second.
- Any non-2xx, malformed body, network failure or 8s timeout → "VERIFICATION UNAVAILABLE",
  grey, with "Do not admit on this result" (verified live by stopping the server).

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
  re-verified in P11 with real ID tokens (unauthenticated, member, guard, Master) against the
  Firestore REST API: every list, read, write and create → `PERMISSION_DENIED`.
- **Email squatting via the public Firebase Auth REST API** (P11) — the web API key is public
  by design, so anyone can call `accounts:signUp` directly and create a bare Auth account
  holding someone else's email. `createPerson` now reserves every identifier first (atomic
  `create()` under a fresh personId), then creates the Auth user with that uid; an existing
  Auth account for the email that has **no profile** was therefore created outside the app and
  is deleted (audited `ORPHAN_AUTH_ACCOUNT_REMOVED`). An account *with* a profile is never
  touched (409). Changing one's own Auth email via `accounts:update` is refused by Firebase
  until the new address is verified, so it can't be used to squat.
- **CSRF / login CSRF** (P11) — the session cookie is `SameSite=Lax` (cross-site POSTs don't
  carry it); additionally `proxy.ts` refuses any non-GET `/api/*` request whose `Origin` host
  differs from `Host` or whose `Sec-Fetch-Site` is `cross-site`/`same-site`. This also stops a
  foreign page from silently signing a browser into an attacker's account.
- **Clickjacking / sniffing** (P11) — every response carries `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin` and a
  Permissions-Policy allowing only the camera (for the guard scanner).
- **Path injection through identifiers** (P11) — emails must match a strict pattern (no `/`,
  no whitespace) because they become `identifiers/{email}` document ids; login rejects any
  identifier containing `/` before it reaches Firestore.
- **Secrets in the repo** — `.env.local`, credentials files gitignored; `.env.example` is
  names only; no secret is ever printed by a script or logged by a route.
- **Username / email enumeration via login** — server-side verification returns the same
  generic failure for unknown identifier and wrong password.

## Pages authorize themselves (post-P12 fix)
A layout is **not** a security boundary in the Next.js App Router: on client-side navigation
Next renders only the changed page segment and skips layouts the browser says it already has.
Before this fix, replaying an ordinary navigation request let a member, a guard or an
anonymous caller receive the admin pages' data (audit log, people, entries, hierarchy). Every
page now checks the session and role itself as its first statement —
`requirePageRole(...)` (`lib/session.ts`) / `requireMasterPage()` (`app/admin/data.ts`) — and
`tests/live/security.mts` replays that exact attack against every admin page.

## Sessions
Firebase session cookies, `httpOnly`, `secure` in production, `SameSite=Lax`, verified with
revocation checking on every request. Lifetime by role: **Master 12 h, guard 16 h, member
5 days**. Deactivation, promotion/demotion, password change/reset and "Sign out of all devices"
revoke every session at once. "Sign out" on one device just clears that device's cookie.

A page reached with an ended session (timed out, revoked) redirects to `/login?expired=1`, which
says so. Sign-in and password requests from the browser go through `lib/clientFetch.ts`: offline,
dropped connections, a 20 s timeout and ended sessions each get a plain message, never a raw error.

## Event registration links (`lib/events.ts`)
- A Master creates an event (name, details, venue, days, gate hours, **link expiry**). Its public
  page is `/e/<token>`: 16 random base64url characters (96 bits), looked up by exact match, never
  guessable from the event id. **Replace link** issues a new token, so every copy of the old one
  stops working at once. **Close** and expiry make the page say registration is closed, and
  `POST /api/register` re-checks the token on submit (410), so a page left open past the
  deadline can't register anyone.
- A link registration is still only a **PENDING** person (same validation, same rate limit as the
  general page), and always an **event guest**: `/api/register` fixes the type when an event token
  is present, whatever the form sent. A Master may approve them as another type, or change it later. It carries `eventId`, `eventName` and `registrationSource` (utm_source / medium
  / campaign, kept only if they look like short tags). Dependants may leave out an employee there;
  approval places them under the approving Master. Approval gives the event's days and hours.
- Events are Master-only end to end (`requireMaster`, checked before the body is read).

## Bulk decisions (`lib/decisions.ts`, `POST /api/decisions`)
One registry for every approve/reject: registration or access request, one or up to 100. Each
item runs through the same function as a single click (`assertCanActOn` and every rule, per
item), so bulk grants no extra authority; an item that fails (not yours, already decided) is
reported and the rest continue.

## Forgot password and email confirmation (`lib/auth/emailActions.ts`)
- **Forgot password** (`POST /api/auth/forgot`): the answer is fixed and sent before any lookup —
  the email goes out afterwards (`after()`), so neither the words nor the timing show whether an
  account exists. Only approved, active accounts get a link. Rate limited per IP.
- The link carries Firebase's one-time code. `/auth/action` checks it **without using it up**
  (bots that pre-open links can't burn it); the new password must pass the same rules as any
  other (below) and differ from the current and previous one; then every session is revoked, a
  pending forced change is cleared, and the email counts as confirmed.
- **Email confirmation**: a link at sign-up (and "Send the link again" on My account). Firebase
  only sends these for a signed-in user, so the server signs in as them with a one-off custom
  token — no password involved. Approvers see "email confirmed / not confirmed".
- **Test addresses** (`*.test`) never reach Firebase's mailer; links go to the Master-only outbox.
- **Password rules** everywhere a password is chosen (`lib/auth/passwordPolicy.ts`): 8–128
  characters, not a well-known password, not containing the name/username/email, and not in a
  known breach (Have I Been Pwned range API: only the first 5 hex characters of the SHA-1 leave our
  server or the browser; fails open if the service is down).
- **Live sign-up checks** (`GET /api/register/check`) say whether a username/email is taken —
  the same thing submitting already says — and are rate limited per IP.
- **Turnstile** (optional): registration and forgot-password require it when its keys are set.

## Gate additions
- **Exits** are recorded, never refused (nobody is kept in): the scan must still identify a real
  person; result `EXITED`, `people.lastExitAt`. "On campus now" = entered today, no exit since.
- **Photo ID seen** (`POST /api/guard/id-check`): guard only, and only against an entry *that
  guard approved in the last 10 minutes* — a guard can't mark someone who isn't in front of them.
  Stores the ID type and at most its last 4 characters; never a number, never an image.

## Password reset (Master) — forced change
- **Reset** (`resetPassword`): one-time password set, sessions revoked, custom claim
  `mustChangePassword: true` set (claim first, so a failure later still forces the change).
- **Signing in with it** issues a session whose claim makes `getSessionUser()` return **null**
  everywhere — every page and API treats it as signed out (fail closed; no route has to remember
  a check). Pages send it to `/set-password` (`requirePageRole`); only `getPasswordResetSession()`
  (the set-password page and `POST /api/auth/set-password`) accepts it.
- **New password** must differ from the one-time password **and** the password held before the
  reset (also across several resets). Password set first, claim cleared second, then a fresh
  session — an interruption in between just asks again. A retry after a lost reply is answered
  "session ended — sign in with your new password if you already chose one".
- **No passwords are stored, readable or otherwise.** Firebase Auth holds the real (hashed)
  password. `passwordHashes/{personId}` (server-only, deny-all rules) holds salted **scrypt
  fingerprints** — `current` (learned at creation, sign-in and change), `previous` and
  `oneTime` during a reset, both cleared after it — enough to answer "same as before?" and
  nothing more. Promotion/demotion merge claims, so a pending reset survives them.
- **Testing:** `npm run test:password -- <username> [password]` (local, Admin SDK) sets a known
  password on a test account and writes it to the git-ignored `.demo-credentials.local.txt`.

## Rate limiting and request size (`proxy.ts`, `lib/rateLimit.ts`)
In-memory, per server instance, writing nothing to Firestore (so it can't be used to burn the
free tier's quotas). Keys follow the person: signed-in traffic per session, a high per-IP ceiling
for scripts (a campus may share one Wi-Fi address). Budgets: sign-in 10 attempts per account per
IP per 10 min (plus Firebase's own lockout of an account after repeated wrong passwords) and
300 per IP; registration 30 per IP per hour; gate 120 checks per guard per minute; other API
writes 60 / reads 300 per minute; 3,000 requests per IP per minute overall. API bodies over 1 MB
are refused before parsing. Over budget → 429 with `Retry-After` and a plain message.

## Accepted risks (reviewed in P11, deliberately not changed)
- **Registration reveals whether a username or email is taken** — a public sign-up form has to
  say so; login itself stays non-enumerating.
- **Rate limits are per server instance** — best-effort on serverless (Fluid compute reuses
  instances, so they hold well in practice); a determined distributed attacker could exceed them.
  Edge rate limiting (Vercel WAF) would need a new package and dashboard rules.
- **Bare Auth accounts can still be created via the REST API** — they can't sign in to the app
  (no identifier, no claim, Firestore denies them) and are removed if they ever block a real
  registration. Optionally disable sign-up at the source: Firebase console → Authentication →
  Settings → User actions → untick "Enable create (sign-up)" (the Admin SDK is unaffected).

## Intentionally out of scope for this release
Government-ID / Aadhaar verification, biometrics, external identity providers, rate limiting
and brute-force login protection (Firebase Auth's own defaults apply), MFA, offline gate
verification. The identity model keeps `people` and the future verification concern
separate so an external verification module can attach to a person later without redesign.

## Firestore rules — deployment
Rules are in `firestore.rules`; deploy with `firebase deploy --only firestore:rules`.
**The deny-all rules are deployed** (Expansion P4, 2026-10-21) and verified: unauthenticated,
member, guard and even Master ID tokens all get `PERMISSION_DENIED` on every read and write
via the Firestore REST API.
