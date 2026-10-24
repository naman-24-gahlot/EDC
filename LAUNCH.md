# Launch, handover and what's left

Written 2026-10-24, when the prototype was feature-complete for this round. Nothing here has been
done yet — it's the list to work through **after** you've finished checking and testing.

---

## 1. Setup still pending (all free)

| # | What | Where | Why / effect until done |
|---|---|---|---|
| 1 | **App emails** — `SMTP_USER` + `SMTP_PASS` (Gmail address + 16-letter app password) | Vercel → Project → Settings → Environment Variables (Production), then redeploy. Steps: DEPLOYMENT.md "Emails" | Approval summaries, visitor passes, stay alerts, leave decisions and backup-email resets are **skipped** (logged on Admin → Emails sent). Also makes the app send password-reset / confirm-email itself, so those links open our own page |
| 2 | **Firebase action URL** | Not possible — Firebase refuses for this project (console: "An error occurred when updating action URL"; API: `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`) | Solved by #1 instead. Nothing to do |
| 3 | **Human check** (Cloudflare Turnstile) — `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | dash.cloudflare.com → Turnstile → add site (both your hostnames) → Vercel env vars | Sign-up / forgot-password have no bot check (rate limits only) |
| 4 | **`APP_ORIGIN`** (optional now, required with a custom domain) | Vercel env var, e.g. `https://access.yourdomain.in` | Used for links in emails when a request's host isn't one we know. Default is `https://edc-gib-24.vercel.app` |
| 5 | **`EDC_EMAIL_DOMAIN`** (optional) | Vercel + `.env.local` | Institutional login email identifiers aren't assigned |
| 6 | **Firebase "Authorized domains"** — add any new domain | Firebase console → Authentication → Settings → Authorized domains | "Confirm your email" links fail on a domain that isn't listed |
| 7 | **Backups** (deferred by you) | — | No automatic backup on the free plan. Planned: a Master-side download + reminder |
| 8 | **Privacy notice and consent** (deferred by you) | — | Needed before real use (India's DPDP Act 2023) |

Do **not** turn off Firebase "Enable create (sign-up)" — email confirmation before registering needs it.

---

## 2. Moving everything to a new owner / new accounts

The pieces: **GitHub** (code), **Vercel** (hosting + env vars), **Firebase** (database + sign-in
accounts + passwords), the **sending Gmail**, **Cloudflare** (Turnstile, maybe DNS), and the **domain**.

### The one rule that matters most
Keep **`QR_TOKEN_SECRET`** exactly the same in the new setup. It signs every pass/QR and keys the
tamper-evident audit chain. A new value = every QR and visitor-pass link stops working at once
(people must reissue) and the old audit log can no longer be verified. Copy it from the current
Vercel env vars (or `.env.local`) by hand — never through chat, email or the repo.

### Easiest path — transfer ownership, move nothing
Nothing is copied, passwords keep working, no downtime:

1. **GitHub**: repo → Settings → *Transfer ownership* → the new account/organisation (consider making
   it **private** — the code is public today; it holds no secrets, but there's no need to publish
   the design). Re-connect Vercel to the moved repo if it asks.
2. **Vercel**: Project → Settings → *Transfer project* to the new account/team (env vars, domains
   and deployments go with it). Or invite the new owner to the team and leave.
3. **Firebase**: console → ⚙ Project settings → *Users and permissions* → add the new Google account
   as **Owner** → sign in as it → remove the old one. Same project id, same data, same passwords.
   (Also in Google Cloud console → IAM if prompted.) Then on the new machine: `firebase login`,
   `firebase use edc-access-prototype`.
4. **Service account key** for the Admin SDK: once the new owner is in, generate a **new** key
   (Project settings → Service accounts → Generate new private key), update `FIREBASE_ADMIN_*` in
   Vercel and `.env.local`, redeploy, then **delete the old key** in Google Cloud → IAM → Service
   accounts → Keys. This cuts off the old machine.
5. **Gmail sender / Cloudflare / domain registrar**: change the password + recovery details, or create
   new ones under the new owner and update the env vars.
6. New machine: clone, create `.env.local` from `.env.example`, `npm install`, `npm run dev`.

### Harder path — a brand-new Firebase project
Only if the old project can't be kept. You must copy data and sign-in accounts:

1. Create the project (Spark), enable Email/Password **and** Email link sign-in, add authorized domains.
2. `firebase use <new-id>` → `firebase deploy --only firestore:rules,firestore:indexes`.
3. **Sign-in accounts with passwords**: `firebase auth:export users.json --project <old>` then
   `firebase auth:import users.json --hash-algo=SCRYPT --rounds=… --mem-cost=… --hash-key=… --salt-separator=… --project <new>`
   — the scrypt values are in the OLD project's console (Authentication → Users → ⋮ → *Password hash
   parameters*). Without them everyone must reset their password. User ids (uids) are kept, which
   matters: every person document's id is their uid.
4. **Firestore data**: the free plan has no managed export, so copy with a small Admin-SDK script that
   reads every collection from the old project and writes it to the new one (ask me to write
   `scripts/copy-project.ts` when the time comes — it's ~40 lines). Keep doc ids identical.
5. Point Vercel's `FIREBASE_ADMIN_*` and `NEXT_PUBLIC_FIREBASE_API_KEY` at the new project; keep
   `QR_TOKEN_SECRET`. Redeploy, sign in as a Master, check the audit page's **Check integrity**.

---

## 3. Your own domain

### Buying it
- Best value: **Cloudflare Registrar** (sells at cost, ~₹900/yr for `.com`), or Namecheap / GoDaddy;
  `.in` is cheaper (~₹500–800). Turn on auto-renew and registrar lock; keep the account under the
  institution's email so it doesn't lapse with one person.
- **Cheaper still: ask IIM Jammu IT for a subdomain** of the institute's domain (e.g.
  `access.iimj.ac.in`) — free, looks official, and they add one DNS record for you.

### Connecting it
1. Vercel → Project → Settings → **Domains** → add `access.yourdomain.in` (and the bare domain if you
   want it). Vercel shows the DNS record to add:
   - subdomain → **CNAME** to the target Vercel shows (e.g. `cname.vercel-dns.com`)
   - bare domain → **A** record to the IP Vercel shows
   HTTPS certificates are automatic (a few minutes after DNS resolves).
2. Make it the **primary** domain and let `*.vercel.app` redirect to it.
3. Vercel env vars: `APP_ORIGIN=https://access.yourdomain.in` and `APP_HOSTS=access.yourdomain.in`
   (comma-separate several). Redeploy. Without these, email links keep using the vercel.app address.
4. Firebase → Authentication → Settings → **Authorized domains** → add it.
5. Cloudflare Turnstile → the site's hostname list → add it.

### Technical things to know
- **Everyone signs in again** on the new domain (cookies belong to one host). Passwords don't change.
- **QR passes keep working** (they aren't tied to a domain). **Visitor-pass links** already sent point at
  the old address — they keep working while the vercel.app address redirects.
- The installable app (home-screen icon) is per domain: people re-add it from the new address.
- **Emails from your own domain** (`noreply@yourdomain.in` instead of a Gmail address) need an email
  service that lets you send from the domain plus SPF/DKIM/DMARC DNS records; otherwise mail lands in
  spam. Gmail SMTP keeps working meanwhile. Firebase's own emails can also use your domain: console →
  Authentication → Templates → *Customise domain* (adds DNS records).
- Never put the old `.vercel.app` address in printed material once the domain is live.

---

## 4. Other critical things before real use

1. **Vercel's free (Hobby) plan is for personal, non-commercial use.** An institution running its gate
   on it is likely outside those terms. Before go-live, either have the institute hold a **Pro** plan
   (~US$20/month) or host elsewhere. This is the one cost you probably can't avoid for official use.
2. **The demo seed accounts use real-looking Gmail addresses** (e.g. `rahul@gmail.com`). Those belong
   to strangers: any "forgot password" or app email to them goes to a real person. Before launch,
   delete the seed cast or change their emails to `…@example.test`.
3. **Testing happens on the live database.** Once real people use it, stop testing there: create a
   second free Firebase project for testing (or test only with `.test` accounts and checkpoint/clean).
4. **At least two Masters**, so losing one account doesn't lock everyone out (there's no "super-admin
   recovery" other than the Firebase console).
5. **Free-tier ceilings**: Firestore 50,000 reads / 20,000 writes per day; Firebase's own emails have
   daily caps; Gmail ~500 emails/day. Fine for one campus; watch Firebase → Usage if events get big.
6. **Logs**: Vercel Hobby keeps server logs for 1 hour — the Emails page and the audit log are the
   lasting record.
7. **Dependencies**: run `npm audit` monthly. As of 2026-10-24: Next.js upgraded to 16.4.3 (fixed a
   critical issue); 2 moderate advisories remain inside Firebase's Google libraries (fixed by a
   future firebase-admin major version).
8. **Secrets rotation**: if a laptop with `.env.local` is lost, rotate the Firebase service-account key
   immediately. Rotating `QR_TOKEN_SECRET` is possible but invalidates every pass (see §2).
9. **Privacy notice, consent and a retention rule** (you deferred this) — required before real people's
   photos, mobiles and movements are collected.
10. **Backups** (deferred) — until then, the only copy of the data is Firebase's.
