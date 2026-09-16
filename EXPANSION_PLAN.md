# Expansion Plan — persistent identity, hierarchy, entitlements, reusable credential

Evolves the daily-permission prototype into the system described in the expansion brief.
P1 (this design + docs) is done. Each prompt below is **self-contained**: paste it into a
fresh session (`/clear` first), it runs to completion without checkpoints, and ends with
lint + typecheck + build + live verification + a PROGRESS.md row. Sonnet 5 / high effort
throughout; P4 and P11 are the two where Opus is worth the spend.

Every decision that would otherwise need a mid-session answer is already made here:

| Decision | Resolved as |
|---|---|
| Existing Firestore data | **Reset + re-seed. Pre-approved.** P2 runs `npm run reset:seed -- --yes-i-mean-it` without asking again. |
| Login | Server-side password verification via Firebase REST; identifier resolved server-side. |
| QR credential | Bound to `{personId, credentialVersion}`, reusable; version bump invalidates. |
| Profile photo | Client-downscaled ~256px JPEG data URL on the person doc. No Storage. |
| `EDC_EMAIL_DOMAIN` | Optional env var, already present (empty) in `.env.local`. Empty = EDC identifier not assigned; nothing blocks on it. |
| Public registration & subordinates | One public `/register` page for all six profile types. Subordinate types name their controlling employee (username or access code); that employee or Master approves. Employees can also create subordinates directly (approved on creation). |
| Employees may create | driver, relative, bodyguard, event_guest only. Employees/Incubees register publicly; Master approves. |
| Guards / Master | Guard = system role created by Master. Master = promotion by a Master; first Master comes from the seed. Existing `admin` concept = Master. |
| Member area route | `/me` (built in P7/P9; `/employee` retired in P9 with a redirect). Serves every profile type; "People under me" + approval queue appear only for employees/Master. |
| Access code on profile change | 5 digits stable, prefix follows current type, old string rejected as "Code superseded", `credentialVersion` bumped, ACTIVE entitlement superseded, **no auto-grant**. |
| Composite indexes | Avoid: filter/sort in app code (established convention). If truly unavoidable, add to `firestore.indexes.json` and deploy via CLI. |
| Firebase CLI actions | Attempt `firebase deploy --only firestore:rules` / `firestore:indexes` from the session; the CLI is already authenticated on this machine. Only stop if it isn't. |
| P11 security review | Test **and fix** in the same session (the brief asks for fixes, not just findings). Stop only if a fix needs a design change. |

Docs the prompts refer to: [CLAUDE.md](CLAUDE.md), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md),
[SECURITY_MODEL.md](SECURITY_MODEL.md). Seed script: `scripts/reset-and-seed.ts`
(`npm run reset:seed -- --yes-i-mean-it`), credentials land in `.demo-credentials.local.txt`.

---

## P2 — Identity model + server-side login + data reset

```
Read CLAUDE.md, DATABASE_SCHEMA.md (people, identifiers) and SECURITY_MODEL.md ("Identity and
login", "Two authorization axes").

Implement the identity layer and the new login, then reset the data:

1. lib/auth/: resolveIdentifier(identifier) → personId | null via identifiers/{lowercased};
   verifyPassword(email, password) → idToken via Firebase Auth REST
   accounts:signInWithPassword using NEXT_PUBLIC_FIREBASE_API_KEY (already present — no new
   secret). Then the existing createSessionCookie. Load the person's Auth email server-side
   from the resolved personId; it never appears in any response.
2. Rewrite POST /api/auth/session to accept { identifier, password }. Unknown identifier and
   wrong password return the SAME generic 401 body. DELETE unchanged.
3. Rewrite app/login/page.tsx: one field labelled "Username / EDC Email / Email" + password.
   Remove all client-side Firebase Auth usage. Update components/LogoutButton.tsx to only call
   DELETE and redirect. If lib/firebase/client.ts then has no importers, delete it and remove
   the `firebase` dependency (keep firebase-admin). Don't leave dead code.
4. lib/session.ts reads the `systemRole` claim (not `role`); SessionUser = { personId, email,
   systemRole }. lib/roles.ts → SystemRole ('master'|'guard'|'member') + ROLE_HOME_PATH:
   master → /admin, guard → /guard, member → /employee (for now; P9 moves it to /me).
   Layouts: /admin requires master; /guard requires guard; /employee allows member OR master.
5. Delete scripts/seed-users.ts and scripts/seed-demo-data.ts and their npm scripts — they
   target the old schema. scripts/reset-and-seed.ts replaces them.
6. Run: npm run reset:seed -- --yes-i-mean-it   (destructive — PRE-APPROVED, do not ask.)
7. Existing employee/admin/guard pages and the old request routes reference collections that
   no longer exist. Do NOT rewrite them (P5–P10 replace them). Only make the minimum edits so
   `npm run build` passes; it's acceptable for them to render empty until then. Note this in
   PROGRESS.md.

Scope: lib/**, app/login/**, app/api/auth/**, app/*/layout.tsx, components/LogoutButton.tsx,
scripts/**, package.json. Do not touch app/api/guard, app/api/admin, app/api/employee.

Verify live (start the dev server, use .demo-credentials.local.txt): sign in as `rahul`, as
`rahul@gmail.com`, and — if EDC_EMAIL_DOMAIN is set — as the EDC address; all three land on
/employee as the same person. `master` → /admin, `guard1` → /guard. Wrong password and a
non-existent username produce byte-identical responses. A member hitting /admin is bounced.

Finish: npm run lint, npx tsc --noEmit, npm run build — paste results. Add a PROGRESS.md row
"Expansion P2".
```

## P3 — Registration, approval, access codes

```
Read CLAUDE.md, DATABASE_SCHEMA.md (people, identifiers, accessNumbers, Registration state
machine) and SECURITY_MODEL.md ("Registration and approval authority").

1. lib/access/codes.ts: PREFIX map; issueAccessNumber() — random 10000–99999, uniqueness by
   create() on accessNumbers/{digits} with retry; accessCodeFor(person) = PREFIX + number.
2. lib/people/create.ts: createPerson(input, { createdBy, parentId, registrationStatus })
   — creates the Auth user (email = commEmail exactly as entered; password from the
   registrant), sets the systemRole claim, computes ancestorIds from the parent, and writes
   people + identifiers (+ accessNumbers if approved) in ONE batch using create() so a taken
   username/email fails atomically. Username rule [a-z0-9._-]{3,30}, lowercased; emails
   lowercased only for the identifiers key.
3. POST /api/register (public, unauthenticated): all spec fields + password + profileType +
   photoDataUrl. For driver/relative/bodyguard/event_guest the registrant must supply their
   controlling employee's username or access code; resolve it server-side to an approved,
   active employee and set parentId from that — never from a raw client id. Employee/incubee
   register top-level. Result: registrationStatus PENDING, active false. Validate the photo is
   a data:image/jpeg;base64 URL ≤ 150 KB. Audit REGISTRATION_SUBMITTED with actorId 'public'.
4. POST /api/people (authenticated): an employee or Master creates a subordinate
   (driver/relative/bodyguard/event_guest only). parentId := the actor's personId, set
   server-side. Written as APPROVED immediately; access number issued; audit both
   REGISTRATION_SUBMITTED and REGISTRATION_APPROVED plus PROFILE_CREATED under the actor.
   Return the generated password once, like the old add-employee route did.
5. POST /api/registrations/[personId]/approve and /reject. Authority for now: master, or
   actor.personId === target.parentId (P4 generalizes this to assertCanActOn). Approve issues
   the access number, sets active true, records registrationDecision. Master may also approve
   a REJECTED person. Audit accordingly.
6. UI: app/register/page.tsx (mobile-friendly; profile-type select; parent field appears for
   subordinate types; photo input downscaled client-side to max 256px JPEG via canvas; success
   state "Registration submitted — pending approval"). app/admin/registrations/page.tsx
   listing PENDING (and REJECTED) people with approve/reject, plus an "Registrations" link in
   AdminNav. The subordinate-creation UI comes in P9; test the route directly for now.

Scope: lib/access/codes.ts, lib/people/**, app/register/**, app/api/register/**,
app/api/people/route.ts, app/api/registrations/**, app/admin/registrations/**,
app/admin/AdminNav.tsx. Don't touch guard, entitlements, requests.

Verify live: register publicly as a new employee → appears PENDING for master → approve →
person has an EDC-prefixed code and can log in by username. Register a driver naming `rahul`
as parent → PENDING with parentId = Rahul's id. Registering with a taken username fails with
no partial docs written (check identifiers/ and people/). As `rahul`, POST /api/people to
create a relative → immediately APPROVED with a REL code. As `neha`, try to approve Rahul's
pending driver → 403.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P3".
```

## P4 — Hierarchy + scoped authorization + Firestore rules  (Opus recommended)

```
Read CLAUDE.md ("Authorization"), DATABASE_SCHEMA.md ("Hierarchy rules") and
SECURITY_MODEL.md ("Hierarchical authorization", "Core pattern").

1. lib/hierarchy/: computeAncestorIds(parent); assertCanActOn(actor: SessionUser,
   targetPersonId) — loads the target and passes iff actor.systemRole === 'master' or
   actor.personId ∈ target.ancestorIds; throws a typed 403 otherwise; listDescendants(personId)
   via array-contains on ancestorIds; rehome(personId, newParentId) — Master-only, rejects
   cycles (new parent may not be the person or any descendant), enforces the "only employee/
   Master can be a parent" rule and depth ≤ 5, rewrites ancestorIds for the whole subtree in
   one batch, audits HIERARCHY_CHANGED.
2. Replace P3's direct-parent check in the registration approve/reject routes with
   assertCanActOn. Apply assertCanActOn to every existing route that acts on another person.
3. New Master-only routes: POST /api/people/[id]/parent (rehome), /promote and /demote
   (systemRole master ↔ member; a Master can never target their own personId; demoting the
   last remaining Master is refused), /deactivate and /reactivate (deactivate = Auth disable +
   revokeRefreshTokens + active:false + credentialVersion bump, as before). All audited.
4. firestore.rules → deny ALL client reads and writes on every collection. Deploy it:
   run `firebase deploy --only firestore:rules`. If the CLI reports it is not logged in, stop
   and tell the user exactly that one command to run — otherwise continue.

Scope: lib/hierarchy/**, app/api/people/**, app/api/registrations/**, firestore.rules.

Verify live with direct fetch calls using seeded sessions: `rahul` acting on Ramesh Yadav
(Neha's driver) → 403; `neha` acting on Suresh Kumar → 403; `master` on either → 200;
`rahul` POST /promote on himself → 403; `master` rehoming Rahul under Suresh → 400 (cycle /
invalid parent); after rehoming Suresh under Neha, Rahul loses authority over him and Neha
gains it. Re-run the Session 8 client-SDK probe pattern (temporary script, deleted after) to
confirm unauthenticated, member and guard sessions get permission-denied on every read.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P4".
```

## P5 — Entitlements + the single access evaluator

```
Read CLAUDE.md, DATABASE_SCHEMA.md (entitlements, templates, Entitlement state machine) and
SECURITY_MODEL.md ("Access credential" steps 2–8, "Time-based state without a cron").

1. lib/date.ts: add nowInIST() → { date: 'YYYY-MM-DD', weekday: 0–6, time: 'HH:MM' }.
2. lib/access/entitlements.ts: TEMPLATES (per DATABASE_SCHEMA.md), effectiveStatus(ent, today)
   (ACTIVE | REVOKED | SUPERSEDED | EXPIRED | SCHEDULED), getActiveEntitlement(personId),
   grantEntitlement({ personId, approvedBy, sourceRequestId, overrides }) — in a transaction:
   any ACTIVE → SUPERSEDED, new ACTIVE created from the person's current profile-type
   template merged with overrides; revokeEntitlement(id, by, reason) — bumps the person's
   credentialVersion; editEntitlement(id, by, patch) — no bump. All audited in-operation.
3. lib/access/evaluate.ts: evaluateAccess(person, now) implementing steps 2–7 exactly, in
   order, returning { allowed, reason, entitlement }. This is the ONLY place those rules live.
4. Routes: POST /api/people/[id]/entitlements (Master or ancestor: direct grant),
   POST /api/entitlements/[id]/revoke, PATCH /api/entitlements/[id]. All via assertCanActOn.

Scope: lib/date.ts, lib/access/**, app/api/entitlements/**, app/api/people/[id]/entitlements.

Verify with a temporary script (delete it afterwards) driving evaluateAccess with controlled
`now` values against seeded people: Rahul allowed Mon 10:00, denied Sat 10:00 ("Outside
permitted days"), denied Mon 17:00 ("Outside permitted hours" — end is exclusive), denied Mon
08:59; grant Arjun an entitlement with endDate yesterday → "Access expired"; startDate
tomorrow → "Access not yet active"; revoke Rahul → "Access revoked" and credentialVersion
incremented; grant again → previous one SUPERSEDED, exactly one ACTIVE.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P5".
```

## P6 — Access-request lifecycle (3-day expiry)

```
Read CLAUDE.md, DATABASE_SCHEMA.md (accessRequests, Access request state machine) and
SECURITY_MODEL.md ("Time-based state without a cron").

1. lib/access/requests.ts: createRequest({ personId, requestedBy, purpose, period }) —
   requester must be the person (APPROVED + active) or an ancestor/Master; at most one PENDING
   per person (409); actionableUntil = now + 3 days. expireStaleRequests(filter) — for any
   PENDING past actionableUntil: persist status EXPIRED + expiredMarkedAt, audit
   ACCESS_REQUEST_EXPIRED with actorId 'system'; call this at the top of every queue read and
   inside approve/reject before deciding. approveRequest(id, actor, overrides) — transaction:
   re-check PENDING and not past actionableUntil, assertCanActOn(actor, request.personId),
   grantEntitlement(...) with sourceRequestId, set APPROVED + resultingEntitlementId.
   rejectRequest similarly. All audited.
2. Routes: POST /api/requests (self or on-behalf), POST /api/requests/[id]/approve and
   /reject.
3. Delete the old model's request code: app/api/employee/request/**, app/api/admin/requests/**,
   app/api/admin/_lib/request-transition.ts, and app/admin/RequestActions.tsx /
   RevokeButton.tsx if nothing else imports them. Keep the build green.

Scope: lib/access/requests.ts, app/api/requests/**, the deletions above.

Verify live via fetch with seeded sessions: Vikram Singh's (bodyguard A) seeded PENDING
request — `neha` approve → 403; `rahul` approve → 200, an ACTIVE entitlement now exists for
Vikram; a second POST /api/requests for Vikram while PENDING → 409 (create one first). Ramesh
Yadav's seeded 4-day-old request: after any queue read it is EXPIRED with expiredMarkedAt
set; `neha` approving it → 409, and it is still present in Firestore.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P6".
```

## P7 — Reusable credential + Entry Pass screen

```
Read CLAUDE.md, SECURITY_MODEL.md ("Access credential" — design) and DATABASE_SCHEMA.md
(Credential state machine).

1. Rewrite lib/qr-token.ts: signPassToken(personId, credentialVersion) →
   `${personId}.${credentialVersion}.${hex HMAC}`; parsePassToken; verifyPassSignature with
   timingSafeEqual. lib/access/credential.ts: reissueCredential(personId, by) — bumps
   credentialVersion, audits CREDENTIAL_REISSUED.
2. app/me/layout.tsx (member or master) and app/me/pass/page.tsx — mobile-first, exactly the
   spec mockup: "EDC ENTRY PASS", name, profile type, allowed days + hours, effective
   entitlement status (ACTIVE / NONE / EXPIRED / REVOKED / NOT YET ACTIVE — the entitlement's
   effective status, not the time-of-day verdict), the access code large in monospace, a QR
   at least 280px rendered with error-correction level 'M', photo thumbnail if present, and
   "Present this pass at the gate." If there is no ACTIVE entitlement, show the status
   prominently and no QR. The token is computed server-side on render; nothing about viewing
   or scanning changes it.
3. Leave app/employee/** in place for now (P9 retires it); add a link from it to /me/pass.

Scope: lib/qr-token.ts, lib/access/credential.ts, app/me/**, one link in app/employee/page.tsx.

Verify live: Rahul's pass renders with EDC25166 and a QR; reloading yields the identical
token; a temporary script (deleted after) confirms verifyPassSignature passes for that token,
fails for a tampered signature, and — after reissueCredential — the old token's version no
longer matches the person doc. Priya Nair (guest A, 2-day entitlement) gets a pass; Karan
Mehta (guest B, no entitlement) sees NONE and no QR.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P7".
```

## P8 — Guard verification + entry events

```
Read CLAUDE.md, SECURITY_MODEL.md ("Verification — one path for both methods", "What the
Guard is shown", "Fail-safe") and DATABASE_SCHEMA.md (entryEvents).

1. Rewrite app/api/guard/verify/route.ts: requires systemRole guard; body { token } OR
   { code }. Resolve exactly as SECURITY_MODEL.md step 1 (QR: parse → HMAC → person → version
   match, else "Invalid QR"; code: ^[A-Z]{3}[0-9]{5}$ → accessNumbers/{digits} → person →
   prefix must match PREFIX[person.profileType] else "Code superseded"; unknown → "Invalid
   access code"). Then evaluateAccess(person, nowInIST()). EVERY outcome appends an entryEvent
   and an audit entry (ENTRY_APPROVED / ENTRY_DENIED) in the same operation. A successful
   entry changes nothing on the person or entitlement. Response: { approved, reason, person:
   { name, profileType, photoDataUrl } } — nothing else about the person.
2. app/guard/GuardScanner.tsx: keep the camera/manual tabs and the auto-resume behaviour. The
   manual field accepts either a code (matches the code regex → send { code }) or a pasted
   token (→ send { token }). Render the verdict large with the person's name, photo and
   profile type. Any non-2xx or network failure shows "VERIFICATION UNAVAILABLE" in a neutral
   colour, never green, and never implies approval. Clear the field after each submit.

Scope: app/api/guard/**, app/guard/**.

Verify live as guard1: Rahul's token → ENTRY APPROVED, again → ENTRY APPROVED (reusable; two
entryEvents); "EDC25166" → ENTRY APPROVED; Karan Mehta's code → "No active access"; a token
with one signature character changed → "Invalid QR"; a random code → "Invalid access code";
as master revoke Rahul's entitlement → his old token → "Invalid QR" (version bumped) and his
new pass's token → "Access revoked"; as master edit Priya Nair's hours to 00:00–00:01 → her
code → "Outside permitted hours". Stop the dev server mid-request once → the UI shows
VERIFICATION UNAVAILABLE. Confirm every attempt above is in entryEvents and auditLogs.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P8".
```

## P9 — Member area (/me) + approval queue

```
Read CLAUDE.md, DATABASE_SCHEMA.md and SECURITY_MODEL.md ("Hierarchical authorization").

Build app/me/** as the home for every signed-in member (all profile types) and Master:
- Profile: names, username, EDC email (or "not assigned"), communication email, mobile,
  profile type, registration status, photo.
- Access: current entitlement (effective status, dates, days, hours), access code, link to
  /me/pass.
- Requests: raise a request (purpose + optional period) via POST /api/requests; list own
  requests with status, history included (EXPIRED shown, never hidden).
- People under me (employees and Master only): each subordinate with their profile type,
  effective access status and pending request; a "Create person under me" form (driver /
  relative / bodyguard / event_guest, all registration fields, photo downscaled client-side)
  calling POST /api/people; approve/reject their registrations and access requests inline.
  Every listing is a server-side query on ancestorIds via listDescendants — no client-side
  filtering of a broader set, ever.
- Retire app/employee/**; ROLE_HOME_PATH member → /me; add a redirect from /employee to /me.
  Update components/RoleHeader.tsx labels accordingly.

Scope: app/me/**, app/employee (deletion + redirect), lib/roles.ts, components/RoleHeader.tsx.

Verify live: `rahul` sees Suresh, Anita, Vikram, Priya and Vikram's pending request, and
approving it creates his entitlement; `rahul` does NOT see Ramesh or Karan anywhere, and a
direct fetch to approve Karan's request → 403; `neha` sees only Ramesh and Karan; `arjun`
(incubee) sees Profile/Access/Requests and no People section; `master` sees everyone.
Rahul creates a new relative from the form → APPROVED, REL code, appears in his list.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P9".
```

## P10 — Master / Admin dashboard

```
Read CLAUDE.md and DATABASE_SCHEMA.md.

Rebuild app/admin/** for Master scope, replacing the old pages (delete app/admin/employees,
app/admin/history, StatusBadge.tsx if unused):
- Registrations: PENDING and REJECTED people; approve / reject / approve-a-rejected.
- People: searchable list (name, username, code, profile type, status, parent); person page
  with deactivate/reactivate, profile-type change (implements the documented rule: history
  entry, code prefix change, credentialVersion bump, ACTIVE entitlement superseded, no
  auto-grant; rejects changing an Employee with live subordinates to a non-parent type),
  rehome (parent picker), promote/demote Master (never self), reissue credential, direct
  entitlement grant with the template pre-filled and editable, revoke, and that person's
  requests, entitlements, entry events and audit entries.
- Hierarchy: a tree view Master → employees → subordinates from ancestorIds.
- Requests: all, with requester, profile type, parent/controller, purpose, requested period,
  status, actionable-until, and approve/reject; expireStaleRequests runs on load.
- Entries: entryEvents with person, method, result, reason, time.
- Audit: the existing viewer extended for the new action enum and subjectId.
- Guards: create a guard (Master only) — reuse createPerson with systemRole guard,
  profileType null.

Scope: app/admin/**, plus any new Master-only routes under app/api/people/[id]/** (profile-type
change, reissue) not built in P4/P5.

Verify live as master: approve Meera Joshi's seeded pending registration → INC code; change
Suresh Kumar driver → relative → his code prefix becomes REL, his old DRV code is "Code
superseded" at the gate, his previous entitlement is SUPERSEDED, credentialVersion is 2;
attempt to change Rahul (has subordinates) to event_guest → refused; promote Neha to master
then demote; try to demote yourself → refused; create a guard and log in as it.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P10".
```

## P11 — Security review: test AND fix  (Opus recommended)

```
Read CLAUDE.md, SECURITY_MODEL.md and the codebase.

Run the 14 tests from the expansion brief adversarially against a running instance with the
seeded accounts — direct fetch calls to Route Handlers, not the UI — plus a temporary
client-SDK probe (deleted after) for direct Firestore access:
1 Employee 1 reads Employee 2's subordinate · 2 Employee 1 approves Employee 2's request ·
3 employee promotes self to Master · 4 guard approves a request · 5 guard modifies an
entitlement · 6 forged QR · 7 forged / guessed access code · 8 use outside allowed hours ·
9 expired access · 10 revoked access · 11 read another person's private data via any route ·
12 every protected Route Handler called with no session, wrong role, and out-of-hierarchy
session · 13 unauthorized Firestore reads/writes via the client SDK · 14 employee alters
parentId/ancestorIds through any route or body field.

For each: exploit steps, responsible file, and the minimal fix. Apply the fixes in this
session (the brief asks for fixes, not a report). Re-run the failing test to prove the fix.
Stop and report only if a fix would require changing assertCanActOn semantics or the
credential design. Update SECURITY_MODEL.md if any documented behaviour changed.

Finish: lint, typecheck, build — paste results. PROGRESS.md row "Expansion P11" listing
every finding and its fix.
```

## P12 — Acceptance run + deployment

```
Read CLAUDE.md, DEPLOYMENT.md and the "Acceptance checklist" at the bottom of
EXPANSION_PLAN.md (44 points).

1. Rewrite DEMO_SCRIPT.md for the new flow (registration → approval → code → request →
   entitlement → pass → gate, plus hierarchy scoping and the 3-day expiry), referencing
   .demo-credentials.local.txt for passwords, never embedding them.
2. If .env.local has a NON-EMPTY EDC_EMAIL_DOMAIN, stop and ask the user to set the same value
   in Vercel → Settings → Environment Variables → Production before continuing. If it is
   empty, proceed — nothing to add.
3. Confirm no secrets are staged (git ls-files + a secret-pattern grep, as in Session 9),
   commit, push to main (this triggers the Vercel build), wait for READY, then run the entire
   44-point acceptance list against the deployed URL with real accounts. Log in via username,
   comm email and (if configured) EDC email. Exercise the gate with the same credential
   several times. Run the reset+seed against the live project first if the data has drifted.
4. Report the URL, every acceptance point as pass/fail, and any build or runtime error (fix
   deployment-scope errors; stop for anything else). The one thing that cannot be verified
   from here is a physical camera scan — say so explicitly.

Finish: PROGRESS.md row "Expansion P12" with the acceptance results.
```

---

## Manual intervention — what's actually left

| When | What you do | Why | Otherwise |
|---|---|---|---|
| Any time (optional) | Set a real `EDC_EMAIL_DOMAIN` in `.env.local` | Only you know the institutional domain; I won't invent one | Leave empty — EDC email identifiers just aren't assigned; nothing blocks |
| P4 / P6 / P9 (only if it fails) | `firebase login` | The session will try `firebase deploy --only firestore:rules` / `:indexes` itself using the CLI's existing login | If the CLI is still logged in from earlier sessions, nothing to do |
| P12 (only if you set a domain) | Add `EDC_EMAIL_DOMAIN` to Vercel → Production env vars | Env values are never handled by the session | If empty locally, skip |
| P12 | One QR scan from a real phone camera | No camera exists in the session's browser | Everything else is verified against the deployed URL |

Removed from the previous plan: the data-reset approval (pre-approved above), new Firebase
services, new secrets, Storage/billing.

---

## Acceptance checklist (from the expansion brief — P12 runs every line against the deployed URL)

1. Person receives registration link. 2. Person registers. 3. Enters name. 4. Enters
username. 5. Enters communication email. 6. Chooses password. 7. System assigns/configures
EDC institutional email (or marks it unassigned when no domain is configured). 8. Chooses
profile type. 9. Registration becomes pending. 10. Authorized approver approves. 11. Persistent
profile exists. 12. Person receives a profile-specific access code (EDC/INC/GUE/DRV/REL/BDG +
5 digits). 13. Employee receives active access Mon–Fri 09:00–17:00. 14. Employee can use
access repeatedly within those rules. 15. Incubee receives 90-day access with the same
weekday/time rules. 16. Guest receives event-period access. 17. Access expiration does not
delete the profile. 18. Expired user can request new access without re-registering.
19. Employee can create subordinate profiles. 20. Subordinate profile persists.
21. Subordinate raises an access request. 22. Parent employee sees the request.
23. Unrelated employee cannot see it. 24. Master can see it. 25. Parent employee can approve
it. 26. Master can approve it. 27. Approved person gets active access. 28. Person opens their
Entry Pass. 29. QR is clearly visible. 30. Human-readable code is clearly visible. 31. Guard
scans QR OR enters code. 32. Backend evaluates the current entitlement. 33. Valid access →
ENTRY APPROVED. 34. Invalid access → ENTRY NOT APPROVED with a reason. 35. Entry is logged.
36. The same credential keeps working for later entries while valid. 37. A pending request
older than 3 days leaves the active approval queue. 38. The expired request remains in
history. 39. Profile remains after entitlement expiration. 40. Master can change profile type.
41. Identity and historical records remain intact. 42. Employee 1 cannot access or approve
Employee 2's descendants. 43. Master can manage all descendants. 44. Government-ID
verification is NOT part of this release.
