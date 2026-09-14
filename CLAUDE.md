# EDC Temporary Access Management System

## Purpose
A **prototype** replacing handwritten daily entry permissions for temporary/tenure-based
EDC personnel. This is a demo-ready prototype, not a production system — optimize for a
correct, secure, presentable demo, not for scale or completeness.

Flow: Employee requests today's entry → Admin approves/rejects → approved employee gets a
digital pass with a signed QR code → Guard scans (or manually enters the token) → system
verifies → ENTRY APPROVED / NOT APPROVED → check-in recorded → audit trail maintained.

Full schema: see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).
Security rules and QR token design: see [SECURITY_MODEL.md](SECURITY_MODEL.md).
Session-by-session status: see [PROGRESS.md](PROGRESS.md).

## Architecture (locked — do not re-evaluate)
- Next.js App Router + TypeScript + Tailwind CSS
- Firebase Authentication — **email/password only**, no OAuth providers
- Cloud Firestore — source of truth for users, requests, and audit logs
- Roles via **Firebase custom claims**; a mirrored `users/{uid}` doc holds display info only
- **All privileged reads/writes happen in Next.js Route Handlers using the Firebase Admin
  SDK.** No Cloud Functions.
- Firestore security rules **deny all client-side writes** — every mutation goes through a
  Route Handler that verifies the caller's ID token and role server-side first. Rules exist
  to scope client-side *reads* correctly (defense in depth), not to authorize writes.
- QR token: HMAC-SHA256 via Node's built-in `crypto`, secret in a server-only env var
- `qrcode` to generate, `html5-qrcode` to scan; manual token entry is a required fallback,
  not an afterthought
- Deploy target: Vercel (Hobby tier) + Firebase (Spark tier) — no billing required

## Roles (non-negotiable boundaries)
- **Employee**: log in, request entry for the current day (max one request per day), view
  own status/history, view own approved QR pass. Cannot approve/reject, cannot change own
  status, cannot read another user's data, cannot reach admin/guard routes.
- **Admin**: two EDC heads with equivalent master access. View pending requests,
  approve/reject, revoke approvals, manage temporary employee accounts, view entry history
  and audit logs.
- **Guard**: scan QR or manually enter a token, verify authorization, mark check-in. Cannot
  approve/reject, cannot modify permissions, cannot reach admin routes.

Role is always resolved server-side from the verified ID token's custom claims. A
client-supplied role value is never trusted.

## Entry states
`PENDING → APPROVED | REJECTED`
`APPROVED → REVOKED | CHECKED_IN`
An `APPROVED` request whose date is no longer today is treated as expired at verification
time (computed, not a stored transition — no cron job in this prototype).
Every transition is written by a Route Handler and produces one audit log entry in the same
server-side operation.

## Coding conventions
- TypeScript strict mode. Avoid `any` without a one-line justification comment.
- Keep `employee/`, `admin/`, and `guard/` feature code in separate folders; do not
  cross-import UI between them.
- Keep all Firebase Admin SDK usage inside Route Handlers — never import it into client
  components.
- No new dependencies or architectural patterns beyond what's listed above without asking
  first.

## Out of scope — do not build, do not prepare for
Password reset, email/SMS notifications, employee self-registration, pagination, analytics
dashboards, dark mode, offline support, multi-day or date-range requests, photo uploads,
profile editing, i18n.

## Testing expectations
Every implementation task ends with `next build` (or `tsc --noEmit`) run and the result
reported before the task is considered done.

## Documentation maintenance
Update at the end of every session, only the files actually affected:
- `PROGRESS.md` — always, one line: session, what was done, status.
- `DATABASE_SCHEMA.md` — if schema or state transitions changed.
- `SECURITY_MODEL.md` — if rules, roles, or the QR token design changed.
Read only what the current task needs — don't re-read the full doc set every session.

## Context/usage discipline
- Stay strictly within the file scope stated in the current task. Do not touch files
  outside it.
- Do not introduce abstractions, dependencies, or "improvements" beyond what was asked.
- If stuck after two failed attempts on the same issue, stop and report instead of
  continuing to iterate.

## When to stop and ask (do not guess or proceed)
- A task needs a Firebase/Vercel console action, a new secret, or an env var value.
- A change would affect Firestore rules or the QR token signing scheme outside a session
  explicitly scoped for that.
- The spec is ambiguous about who should have access to something.
- A fix would require touching files outside the current task's stated scope.
