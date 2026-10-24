# Deployment

## Environment variables

Set these in the Vercel project's dashboard (Settings → Environment Variables), not in
any committed file. Names only — see `.env.example` for the authoritative list, values
come from the Firebase console (Project settings → General for the client config,
Project settings → Service accounts → Generate new private key for the Admin SDK block).

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | **Actually used**, server-side only, since the identity/hierarchy expansion — `lib/auth/login.ts` calls Firebase Auth's REST `signInWithPassword` with it. Public by Firebase's own design despite the `NEXT_PUBLIC_` name; kept for historical continuity with the other five below |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Not currently read by any code — there is no client-side Firebase SDK anymore (login is server-verified, see SECURITY_MODEL.md). Harmless to leave set; not required for a fresh setup |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Same as above — unused |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Same as above — unused (this project also never uses Firebase Storage, see CLAUDE.md) |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Same as above — unused |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Same as above — unused |
| `FIREBASE_ADMIN_PROJECT_ID` | Server-only — Admin SDK (`lib/firebase/admin.ts`) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server-only — Admin SDK |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server-only — Admin SDK. Paste with real newlines or `\n` escapes; `lib/firebase/admin.ts` converts `\n` → real newlines either way |
| `QR_TOKEN_SECRET` | Server-only — QR pass HMAC signing (`lib/qr-token.ts`). A long random string; treat exactly like a password |
| `EDC_EMAIL_DOMAIN` | Server-only, **optional, not a secret** — institutional email domain for the EDC login identifier. Empty/unset = that identifier isn't assigned; username and communication-email login still work. Set it in Vercel only if you set it locally. |

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
7. **Post-deploy, once**: run `npm run reset:seed -- --yes-i-mean-it` locally against the
   *same* Firebase project the deployment uses (it writes directly to Firestore/Auth via
   the Admin SDK — there's no "seed via the deployed site" step; this is a local script
   that happens to affect the shared backend). **Destructive** — wipes and reseeds every
   person; see EXPANSION_PLAN.md. The old `seed`/`seed:demo` scripts from the daily-permission
   prototype were removed in the identity/hierarchy expansion (Expansion P2).

## Region, Fluid compute, tests

- `vercel.json` pins functions to **`bom1` (Mumbai)**, next to the Firestore database
  (`asia-south2`, Delhi). Functions ran in `iad1` (Washington, D.C.) before, so every database
  read crossed the world. The free plan allows any single region. Keep `"framework": "nextjs"` in
  that file: the Vercel project's own framework setting is empty, and without it every route 404s.
- `"fluid": true` turns on Fluid compute (instance reuse; fewer cold starts). Free on Hobby.
- `npm test` — offline unit tests (no credentials needed). GitHub Actions runs lint, typecheck
  and these on every push (`.github/workflows/ci.yml`).
- `npm run test:live` — read-only security probe against a running instance; set
  `BASE=https://edc-gib-24.vercel.app` to probe production. Needs `.demo-credentials.local.txt`.
- `npm run test:password -- <username> [password]` — set a known password on a test account and
  record it in `.demo-credentials.local.txt` (local only; see SECURITY_MODEL.md "Password reset").

## Caching and paging

- **Browser page cache** (`next.config.ts` → `experimental.staleTimes.dynamic = 120`): pages
  already visited are reused for 2 minutes during in-app navigation — no request. Every action
  calls `router.refresh()`, which discards the cache. Sign-in and sign-out are full page loads so
  one account's cached pages are never shown to the next.
- **"Updated … ago · Refresh"** bar (`components/DataStamp.tsx`) on every data page shows how
  old the shown data is; Refresh refetches and returns every list on the page to page 1.
- **Paging** (`lib/paging.ts`, `components/Pager.tsx`, 25 per page): Entries, Audit and decided
  Requests are paged **in Firestore** (offset + limit, plus a cheap `count()`), so a page reads
  ~25 records instead of the whole history. People lists page in memory and read access periods
  only for the rows shown. Names are looked up only for ids on screen (`namesFor`).
- **Streaming**: the person page and `/me` show their top part first; heavy sections (history,
  "people under me") stream in with placeholders. Admin nav badges stream in too.
- **Lists:** People (Master) and People under me (`/me`) have category chips with counts,
  sort (name, recently at gate, newest, code) and a List/Cards view; the Master overview shows
  "Recently at the gate" first, then each category. Audit log: tick-list of actions (grouped),
  date range, order; Entries: result, date range, order. **Download these as CSV** exports
  exactly the filtered rows (`lib/logs.ts` builds the query for page and export alike).
- **Composite indexes** for the paged queries live in `firestore.indexes.json`; deploy with
  `firebase deploy --only firestore:indexes` (they take a minute or two to build — queries that
  need one say "still being prepared" on the page — or 503 on the CSV export — until then).

## Portability

This prototype intentionally runs on **Firebase's Spark (free) tier** and **Vercel's
Hobby (free) tier**, with **no Cloud Functions** — every privileged operation is a plain
Next.js Route Handler using the Firebase Admin SDK (see CLAUDE.md's locked architecture
decisions, SECURITY_MODEL.md's "rules restrict reads, routes own every write" pattern).
No paid tier or billing account is required to run it as-is.

That same choice is what keeps it portable. All Firebase-specific code is isolated behind
one file — `lib/firebase/admin.ts` — and all Firebase/Firestore access goes through
`adminDb`/`adminAuth` exported from it, never through Firebase SDK calls scattered across
route handlers or components. (As of the identity/hierarchy expansion there is no
client-side Firebase SDK at all — login is verified server-side, see SECURITY_MODEL.md —
so `lib/firebase/client.ts` and the `firebase` npm package were removed entirely; the app's
only Firebase touchpoint is the Admin SDK.) If the college later wants this on their own
server or LAN instead of Vercel+Firebase:

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

## Events and bulk decisions

- **Events** (Master → Events): each event has a public registration page `/e/<token>` that works
  until the time set, then says registration is closed. Share it as is or tagged
  (`?utm_source=whatsapp&utm_medium=group`) to see sign-ups per channel. Close, reopen or replace
  the link from the event page. Approved registrants get access for the event's days and hours.
- **Bulk decisions**: Access requests, Registrations and each event's page have tick boxes and a
  "Select all"; approve or reject up to 100 at once (`lib/decisions.ts`: add a new kind of
  decision there and the API and bulk bar support it).
- `npm run test:live` probes with `rahul` by default; `MEMBER=neha npm run test:live` uses another
  member (e.g. while rahul is mid password reset).

## Sign-in, sign-up and the gate (free features)

- **Forgot password / email confirmation** use Firebase Auth's own emails (free). One console
  step makes their links open our page, so our password rules apply: Firebase console →
  Authentication → Templates → Password reset → edit → **Customize action URL** →
  `https://edc-gib-24.vercel.app/auth/action` (the same setting covers email confirmation). Until
  then real-inbox links open Firebase's own page, which works but skips "not your old password".
  Firebase also limits how many of these emails a free project sends per day.
- **Confirm-before-registering** needs two more console settings (both free): Authentication →
  Sign-in method → Email/Password → turn on **Email link (passwordless sign-in)**; and
  Authentication → Settings → **Authorized domains** → add **both** live addresses,
  `edc-neon.vercel.app` (the project's own domain) and `edc-gib-24.vercel.app` (the team alias) —
  the link returns to whichever address the person used. (Both done 2026-10-24.) Until then real addresses get "Email confirmation isn't switched
  on yet"; `.test` addresses work regardless.
- **Test addresses**: any email ending in `.test` (e.g. `qa1@example.test`) never sends — the link
  appears on /admin/outbox ("Test outbox" under the admin menu). Use them for repeated testing.
- **Turnstile** (optional, free): create a widget at dash.cloudflare.com → Turnstile, add the site
  key as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the secret as `TURNSTILE_SECRET_KEY` in Vercel.
  With either missing it stays off.
- **Gate**: Entry / Exit switch, "photo ID seen" (type + last 4), "on campus now" on the guard page
  and Entries page, today's register link; a USB/Bluetooth QR scanner works in the "Type a code /
  USB scanner" tab. The site is installable (manifest + generated icons): browser menu → "Add to
  home screen" / "Install app".
- **Tests**: `tests/live/signup.mts` and `tests/live/gate.mts` (run with `BASE=…`), plus
  `npm run test:data -- checkpoint | report | clean --yes` around them.
