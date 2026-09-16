# EDC Access Management System

## Purpose
A **prototype** (demo-ready, not production) for persistent identity, profile, hierarchy,
access entitlement, reusable gate credential and gate verification at EDC. It evolved from a
daily-permission prototype (PROGRESS.md sessions 1–10); the current model supersedes that.

Flow: person registers once (persistent profile, PENDING) → an authorized approver approves
→ person gets a profile-specific access code → an access request is approved → an
**entitlement** (dates, weekdays, hours) is granted → person shows a **reusable** QR/code at
the gate → Guard verifies against the live entitlement → entry event + audit recorded.
Nothing is consumed by entering; nothing is deleted when access expires.

Docs (read only what the current phase needs):
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — collections, state machines, hierarchy rules
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — login, authorization primitive, credential, gate
- [EXPANSION_PLAN.md](EXPANSION_PLAN.md) — the phase prompts for this expansion
- [PROGRESS.md](PROGRESS.md) — per-session status log
- [DEPLOYMENT.md](DEPLOYMENT.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md)

## Architecture (locked — do not re-evaluate)
- Next.js App Router + TypeScript + Tailwind; Turbopack build; `jose` pinned via `overrides`
- Firebase Auth email/password — **one account per person**, keyed on the communication
  email; username / EDC email / comm email all resolve to it via `identifiers/` docs
- Login is verified **server-side** (Route Handler → Firebase REST `signInWithPassword` →
  session cookie); the client never learns the canonical email
- Cloud Firestore; **all reads and writes are server-side** via Admin SDK; `firestore.rules`
  denies all client access (defence in depth only)
- `systemRole` (`master | guard | member`) in custom claims for route gating;
  `profileType` on the person doc for templates/prefixes; **hierarchy** (`ancestorIds`) for
  every act-on-another-person decision — see "Authorization" below
- Credential: HMAC-SHA256 over `personId.credentialVersion` (Node `crypto`, server-only
  secret) — reusable; invalidated only by a version bump
- `qrcode` to render, `html5-qrcode` to scan; typed access code is a first-class equal path
- Profile photos: client-downscaled data URL on the person doc — **no Firebase Storage**
- No Cloud Functions, no cron: all time-based state is computed at read/verify time
- Deploy: Vercel Hobby + Firebase Spark — no billing, no new third-party services

## Roles, profiles, hierarchy
- **Profile types:** employee, incubee, event_guest, driver, relative, bodyguard. A person
  keeps one identity forever; profile type can change (Master only) without creating a new
  person; history stays.
- **Master** is a promotion granted by an existing Master, never self-selected. System-wide.
- **Guard** is a system role (gate staff), not a profile type. Created by Master only.
- **Hierarchy:** Master → Employees → their subordinates (driver/relative/bodyguard/guest).
  Only employees (and Master) can be parents. `ancestorIds` is server-maintained.

## Authorization (non-negotiable)
- Route areas are gated by `systemRole` from the verified session claim.
- **Acting on another person requires `assertCanActOn(actor, target)`:** Master, or the
  actor's `personId` appears in the target's `ancestorIds`. Nothing else — not profile type,
  not "is an employee", not a client-supplied parentId. Self is never authority.
- Listings of other people are server queries on `ancestorIds`, never client-side filters.
- Never trust from the client: role, systemRole, parentId, personId-as-authority, scope.

## State (summary — full tables in DATABASE_SCHEMA.md)
- Registration: `PENDING → APPROVED | REJECTED` (Master; or parent Employee for own subordinates)
- Access request: `PENDING → APPROVED | REJECTED | EXPIRED(3 days, computed)`; never deleted
- Entitlement: `ACTIVE → REVOKED | SUPERSEDED`; `EXPIRED`/`SCHEDULED` computed from dates
- Credential: no state — valid while HMAC verifies and version matches. **Not one-time.**
- Every transition is written by a Route Handler with its audit entry in the same operation.

## Coding conventions
- TypeScript strict. No `any` without a one-line justification.
- Feature UI stays in its area (`app/employee`, `app/admin`, `app/guard`, `app/register`);
  genuinely shared server logic lives in `lib/` (`lib/access/`, `lib/auth/`, `lib/hierarchy/`).
- Firebase Admin SDK is imported only by Route Handlers / Server Components / `lib`, never by
  client components.
- Uniqueness = deterministic doc ID + `create()`. Time = `lib/date.ts` (IST).
- No new dependencies or patterns beyond this file without asking first.

## Out of scope — do not build, do not prepare for
Aadhaar/government-ID/external identity verification, biometrics, facial recognition,
RFID/gate hardware, offline verification, analytics dashboards, payments, ERP, WhatsApp/SMS/
email notifications, password reset, i18n, dark mode, pagination.

## Testing expectations
Every implementation phase ends with `npm run lint`, `npx tsc --noEmit` and `npm run build`
run and reported. Anything security-relevant is additionally verified live against a running
instance with real accounts, not just by reading code.

## Documentation maintenance
End of every session, only the files affected: `PROGRESS.md` always; `DATABASE_SCHEMA.md` /
`SECURITY_MODEL.md` only if schema, transitions, rules or the credential design changed.

## Context/usage discipline
- Stay within the file scope of the current phase (EXPANSION_PLAN.md names it).
- No unrelated refactors, abstractions or dependencies.
- After two serious failed attempts on the same issue, stop and report the exact blocker.

## When to stop and ask
- A Firebase/Vercel console action, a new secret, or an env var **value** is needed.
- A change would alter the credential scheme or `assertCanActOn` semantics outside a phase
  scoped for it.
- A business rule that affects who may see or act on whom is genuinely ambiguous.
- A destructive data operation is needed that EXPANSION_PLAN.md hasn't pre-approved.
