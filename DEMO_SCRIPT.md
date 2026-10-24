# Demo Script

Click-by-click sequence for presenting the system. ~15 minutes end to end (sections 8–10 are
optional extras). Live URL: `https://edc-gib-24.vercel.app` (or `npm run dev` → `http://localhost:3000`).

## Before you start

1. **Data.** The live site has real sign-ups now, so don't reseed. Instead, before the demo:
   `npm run test:data -- checkpoint`; afterwards `npm run test:data -- report`, check it, then
   `npm run test:data -- clean --yes` (removes only what the demo added — CLAUDE.md "Versions and
   test data"). `npm run reset:seed -- --yes-i-mean-it` still exists but **wipes everything**.
2. **Passwords** for the seeded cast are in `.demo-credentials.local.txt` (on your machine only).
   Every account signs in with its **username** or its **email**, same password.
3. **Use test emails** (`…@anything.test`, e.g. `demo1@example.test`) for anyone you register live:
   their emails never leave — they appear under **Admin → Emails sent** (the test outbox), where
   you can open the confirmation link and read the approval email.
4. **Two browsers / one private window** make the role switches faster.
5. For the gate, open `/guard` on a phone so the camera works. Without a camera, use **Type a
   code** — the same server check, not a weaker fallback.

## Cast (from the seed — the spec's own hierarchy example)

| Who | Username | Role in the demo |
|---|---|---|
| Master Admin | `master` | Approves, manages everyone, holidays, leave |
| Rahul Sharma | `rahul` | Employee 1 — parent of Suresh, Anita, Vikram, Priya |
| Neha Kapoor | `neha` | Employee 2 — parent of Ramesh and Karan |
| Vikram Singh | `vikram.singh` | Rahul's bodyguard — **pending** request in Rahul's queue |
| Karan Mehta | `karan.mehta` | Neha's guest — **no access yet** |
| Gate Guard | `guard1` | The gate |

## 1 — Registration (public, no account needed)

1. Open `/register`. Type an email ending in `.test` and press **Send confirmation link** — Submit
   stays locked until the email is confirmed. In the other browser (as master) open **Emails sent**,
   **Open link** → "✓ Email confirmed"; the form flips to **✓ Confirmed** on its own.
2. Fill the rest: name, username, mobile (a fake like 9876543210 is refused), an optional **backup
   email**, a password (the meter says *Not allowed* for leaked ones), purpose; choose **Driver**;
   enter `rahul` as the controlling employee. Submit → "pending approval".

## 2 — Approval → profile → access code → email (as Rahul)

1. Sign in as `rahul` → **/me**. Under "Registrations to decide", **View their details before
   deciding** opens the applicant's full profile (and lets Rahul fix a typo).
2. Switch **Approve as** to **Bodyguard** and approve. They get a `BDG` code and the bodyguard
   access at once. In **Emails sent**, the approval email shows their profile summary, what they
   were approved as (and what they applied as), their access period and the pass link.
3. Rahul's list shows only his own people — the server never sends Neha's.

## 3 — Request → access (still Rahul)

1. **Approve** Vikram's request → ACTIVE, and Vikram is emailed his visiting hours.
2. **Give usual access** grants a type's default to someone with none. On a person's page the
   access form also has **May stay overnight** (otherwise late/overnight stays raise alerts — §6).

## 4 — The entry pass

1. **Open my entry pass** → `/me/pass`: ACTIVE, a large QR, the access code, days and hours.
2. Reload — same QR. It's tied to the person, not a day: it works every day access allows.

## 5 — The gate (as guard1, ideally on a phone)

1. **Entry** → scan Rahul's pass → **ENTRY APPROVED** with photo. (Or type his code.) Outside his
   hours → **DENIED — Outside permitted hours**: the rules are live.
2. Scan again → still approved: **nothing is consumed by entering**.
3. **On campus now** shows him, grouped (Employees / Event: … / Visitors …) with counts, a CSV
   download and Print — the roll call for an evacuation.
4. Switch to **Exit** and scan → **EXIT RECORDED**; he leaves the list.
5. Type a made-up code → **Invalid access code**. Wi-Fi off → grey **VERIFICATION UNAVAILABLE —
   Do not admit**; it never shows green when it can't reach the server.

## 6 — Stays: late exits, overnight, no exit scan

- Exit more than 15 minutes after someone's gate-closing time → a **Left late** alert (audit log,
  **Admin → Stay alerts**, and their parent's /me).
- Still recorded inside after midnight → **Overnight**, and their parent (or Master, for
  top-level people) gets an email. Coming in again (an hour or more later) without an exit scan → **No exit scan**.
- People with **May stay overnight** are never flagged. **Mark as seen** clears an alert.

## 7 — Master (as master → /admin)

1. **Access requests / Registrations** — with **View profile** next to each.
2. **People → Suresh:** change **Driver → Relative**: code `DRV…` → `REL…`, old code says **Code
   superseded**, access becomes the Relative default (shown before **Save changes**).
3. **Revoke** someone's access → their code says **Access revoked**.
4. **Audit log** → **Check integrity**: "✓ All N entries intact". Every entry is numbered and
   fingerprinted with the one before it; editing or deleting one in the database breaks the chain.

## 8 — Holidays and leave

1. **Admin → Holidays**: add today as "Demo holiday" for Employees. Rahul at the gate → **DENIED —
   Campus holiday**; a visitor or event guest still gets in. Remove it.
2. As `rahul` → **My leave** → ask for tomorrow. As master → **Leave** → Approve; Rahul is emailed.
   On that day the guard still lets him in but sees **On approved leave until …**.

## 9 — Visitor passes (as rahul or master)

1. **/me → + Visitor pass**: name, mobile, a `.test` email, 1 day, tick **VVIP** → **Create pass**:
   a `VIS` code and a pass link (copy it, or it's emailed).
2. Open the link in a private window — no sign-in, the QR and code. At the gate → **ENTRY APPROVED**,
   a **VVIP** badge and "Visitor of Rahul Sharma — escort them"; Rahul gets an arrival email.

## 10 — Events (as master → Events)

1. **+ New event**, copy the link (or tag it, e.g. `?utm_source=whatsapp`), register two people in a
   private window, then **Select all → Approve 2**.
2. The **Event report** on the event page: registered / arrived / inside now / typical stay,
   sign-ups by day, arrivals by hour, who was turned away and why, and no-shows after the event.

## Scoping, the one-line version

Sign in as `neha`: she sees Ramesh and Karan only. Ask her to approve Vikram's request by URL —
the server refuses (403). Authority comes from the hierarchy, checked on the server every time.

## If something breaks mid-demo

- Camera won't start → **Type a code**.
- An email "didn't arrive" → **Emails sent**: the delivery log says sent / skipped (sending not set
  up) / failed, and `.test` addresses are always in the outbox.
- A request "disappeared" → it expired (3 days); it's under **Requests → EXPIRED**.
