# Deployment

## Environment variables

Set these in the Vercel project's dashboard (Settings → Environment Variables), not in
any committed file. Names only — see `.env.example` for the authoritative list, values
come from the Firebase console (Project settings → General for the client config,
Project settings → Service accounts → Generate new private key for the Admin SDK block).

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client Firebase config (public by Firebase's own design) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client Firebase config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client Firebase config |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Client Firebase config |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Client Firebase config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Client Firebase config |
| `FIREBASE_ADMIN_PROJECT_ID` | Server-only — Admin SDK (`lib/firebase/admin.ts`) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server-only — Admin SDK |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server-only — Admin SDK. Paste with real newlines or `\n` escapes; `lib/firebase/admin.ts` converts `\n` → real newlines either way |
| `QR_TOKEN_SECRET` | Server-only — QR pass HMAC signing (`lib/qr-token.ts`). A long random string; treat exactly like a password |

None of the `FIREBASE_ADMIN_*` or `QR_TOKEN_SECRET` values are ever read by client code —
verified in the Session 8 security audit (grepped every importer; all are Server
Components or Route Handlers).

## Deploy steps

1. **Firebase** (one-time, done in earlier sessions): project created, Email/Password
   auth enabled, Firestore created, `firestore.rules` deployed
   (`firebase deploy --only firestore:rules`).
2. **GitHub → Vercel**: repo connected to a Vercel project (done manually — Vercel account
   action, not something Claude Code performs).
3. **Environment variables**: all ten set in the Vercel dashboard for the Production
   environment (done manually, for the same reason — secrets are never typed into chat or
   committed).
4. **Deploy**: `vercel --prod` from the repo root (or push to the branch Vercel is tracking
   — either triggers a build). Vercel runs `next build` using the env vars from step 3.
5. **`package.json` pins `jose` to `^5.10.0` via `overrides`.** `firebase-admin`'s
   dependency tree pulls in `jwks-rsa` → `jose`; the `jose` version that resolves by
   default (6.x) ships ESM-only (no `require` export condition at all), and Vercel's
   Lambda runtime crashes trying to `require()` it (`ERR_REQUIRE_ESM`, surfaced from
   inside Vercel's own function bootstrap, not from Next.js's bundler — confirmed by the
   stack trace and by the fact that switching Turbopack↔webpack made no difference; only
   pinning `jose` to a version with a real CJS build fixed it). We never call anything in
   `jwks-rsa` ourselves — `verifyIdToken`/`verifySessionCookie`/`createSessionCookie` all
   use Firebase's own cert-fetching path — so downgrading the module we never invoke is
   safe; it only needs to *load* without crashing. Verified against the live deployment
   (not just a local build) before considering this fixed — local `next start` did not
   reproduce the crash even when it was present, since it doesn't replicate Vercel's
   function packaging.
6. **If the build fails with `Missing Firebase Admin credentials`**: one or more of
   `FIREBASE_ADMIN_PROJECT_ID` / `FIREBASE_ADMIN_CLIENT_EMAIL` / `FIREBASE_ADMIN_PRIVATE_KEY`
   wasn't visible to the build. In the Vercel dashboard, each environment variable has a
   checkbox for which environments it applies to (Production / Preview / Development) —
   confirm all ten variables are checked for **Production** specifically, not just
   Preview/Development, then redeploy. (Hit this exact error on first deploy — see
   PROGRESS.md.)
7. **Post-deploy, once**: run `npm run seed` and `npm run seed:demo` locally against the
   *same* Firebase project the deployment uses (they write directly to Firestore/Auth via
   the Admin SDK — there's no "seed via the deployed site" step, these are local scripts
   that happen to affect the shared backend).

## Portability

This prototype intentionally runs on **Firebase's Spark (free) tier** and **Vercel's
Hobby (free) tier**, with **no Cloud Functions** — every privileged operation is a plain
Next.js Route Handler using the Firebase Admin SDK (see CLAUDE.md's locked architecture
decisions, SECURITY_MODEL.md's "rules restrict reads, routes own every write" pattern).
No paid tier or billing account is required to run it as-is.

That same choice is what keeps it portable. All Firebase-specific code is isolated behind
two files — `lib/firebase/admin.ts` (server) and `lib/firebase/client.ts` (browser) — and
all Firestore access goes through `adminDb`/the client `auth` object exported from them,
never through Firebase SDK calls scattered across route handlers or components. If the
college later wants this on their own server or LAN instead of Vercel+Firebase:

- **Hosting** moves freely — it's a standard Next.js app (`next build && next start`),
  nothing here depends on a Vercel-specific API or edge feature.
- **The database** is the one real swap: replacing Firestore means reimplementing
  `adminDb`'s call sites (collection reads/writes, the transaction in
  `app/api/guard/verify/route.ts`, the batches in the admin/employee routes) against
  whatever's chosen instead — Postgres, MySQL, etc. Because those calls are concentrated
  in Route Handlers and `lib/firebase/*` rather than spread into UI components, this is a
  data-access-layer swap, not a rewrite of the request/approval/QR/audit logic itself,
  which is plain TypeScript with no Firestore-specific shape baked into it beyond the
  documented schema (DATABASE_SCHEMA.md).
- **Auth** would need a replacement for Firebase Auth (session cookie creation/verification
  in `lib/session.ts`, custom claims for roles) — the same isolation applies, it's confined
  to `lib/session.ts` and the two `lib/firebase/*` files, not woven through every route.

None of this is built yet — it's a "when you need it" note, not a partially-done
abstraction layer. Building it prematurely was avoided on purpose (see CLAUDE.md's
context-discipline rules).
