# Demo Script

Click-by-click sequence for presenting the prototype. ~6-8 minutes end to end.

## Before you start

1. `npm run dev` — confirm it starts clean.
2. Demo data seeded: `npm run seed` (base accounts) then `npm run seed:demo` (populated
   screens) if not already run today. Re-running `seed:demo` is safe — it resets demo
   employees' passwords and refreshes their requests.
3. Firestore rules deployed at least once (`firebase deploy --only firestore:rules`) — see
   SECURITY_MODEL.md.
4. Passwords: base accounts (`admin1/2`, `employee1`, `guard1`) are in
   `.demo-credentials.local.txt`; demo employees (Priya/Rahul/Ananya/Karan) are in
   `.demo-credentials-extra.local.txt` — both gitignored, on your machine only. Have that
   file open in another window during the demo.
5. If presenting on a phone/tablet for the guard step, open the deployed URL there instead
   of localhost so the camera has a real device to use.

## Cast

| Role | Account | Used for |
|---|---|---|
| Employee | `priya.sharma@edc.demo` | Has a live PENDING request today — the one you'll approve live |
| Admin | `admin1@edc.demo` | Approves Priya, adds a new employee, revokes, views audit log |
| Guard | `guard1@edc.demo` | Scans Priya's pass after approval |
| (pre-seeded, not logged into) | `rahul.verma@edc.demo` | Already APPROVED today — used for the Revoke step |
| (pre-seeded, not logged into) | `karan.mehta@edc.demo` | Already CHECKED_IN today — shows up in History/Audit as a completed entry |

## 1 — Employee requests entry (as Priya)

1. Go to `/login`, sign in as `priya.sharma@edc.demo`.
2. Lands on **Employee** — status card shows **PENDING** (already requested by the seed
   script — point out this is exactly what clicking "Request entry for today" produces).
3. Scroll to **History** — shows yesterday's entry as **CHECKED_IN**, proving the history
   view isn't just today's request.
4. Sign out (top-right).

## 2 — Admin approves it (as admin1)

1. Sign in as `admin1@edc.demo`. Lands on **Pending** tab.
2. Priya Sharma's request is listed. Click **Approve**.
3. Queue count drops — request is gone from Pending.
4. Click the **History** tab — Priya now shows **APPROVED**, with a **Revoke** button next
   to it (don't click yet).
5. Sign out.

## 3 — Employee sees the pass (as Priya again)

1. Sign in as `priya.sharma@edc.demo`.
2. Status card now shows **APPROVED**, and a **Your pass** section appears: a QR code plus
   a monospace fallback token underneath.
3. **Either** photograph/zoom the QR for the next step, **or** copy the fallback token text
   — you'll need one of the two for Step 4.
4. Leave this tab open or sign out — either is fine, the pass doesn't depend on being
   logged in as Priya anymore.

## 4 — Guard verifies and checks in

1. On a phone/tablet (for a real camera) or this machine, sign in as `guard1@edc.demo`.
2. Lands on **Guard** — **Camera scan** tab is active by default, asks for camera
   permission.
3. Point the camera at Priya's QR from Step 3. On a match: banner shows **ENTRY APPROVED**
   and Priya's name, auto-dismisses after ~4 seconds, camera keeps running for the next
   scan.
4. **If the camera doesn't cooperate (permissions, lighting, no camera on this machine)** —
   this is the fallback path, worth demonstrating even if the camera worked:
   - Click the **Manual entry** tab.
   - Paste the fallback token text from Step 3.
   - Click **Verify** — same **ENTRY APPROVED** result, same route, same audit trail. This
     is not a weaker backup path — it's the identical server-side check.
5. **Scan or paste the same token again** — this time: **NOT APPROVED** — "Already checked
   in today." This is the single-use guarantee, worth calling out explicitly: the QR
   image itself doesn't expire, but the server-side state does the moment it's used once.

## 5 — Admin: manage employees

1. Sign in as `admin1@edc.demo`, go to the **Employees** tab.
2. Fill in a display name and email (anything unused, e.g. `demo.visitor@edc.demo`), click
   **Add employee**.
3. A green banner shows the generated one-time password — point out this is the only time
   it's ever shown; there's no email/SMS step (deliberately out of scope for the
   prototype), the admin relays it directly.
4. New employee appears in the list with a **Deactivate** button.
5. Click **Deactivate** → **Confirm**. Row now shows **Deactivated** instead of the button.
   (Optional, if you want to prove it's real and not cosmetic: try signing in as that
   account in another tab — Firebase itself refuses with "user-disabled".)

## 6 — Admin: revoke and audit

1. Go to **History**. Find Rahul Verma, **APPROVED**. Click **Revoke** → **Confirm reject**
   — sorry, **Confirm revoke**. Status flips to **REVOKED**, button disappears (can't
   revoke a REVOKED request).
2. Go to **Audit log** — this is the full trail: every request created, approved, rejected,
   revoked, checked in, and every denied scan attempt (including the "already checked in"
   denial from Step 4), each with who did it and when. Scroll to the top for the most
   recent entries (the Revoke you just did, and Priya's check-in from Step 4).

## Talking points while it loads / between steps

- Every button click above hits a real server-side check — approving an already-approved
  request, or an employee requesting twice today, is rejected with a clear error, not just
  hidden in the UI (mention, don't demo, unless asked — see SECURITY_MODEL.md for what was
  actually tested).
- The QR token is signed server-side (HMAC), single-use, and tied to that day — none of
  that logic runs in the browser.
- Runs on Firebase's free tier and Vercel's free tier — no billing required for this
  prototype.

## If something breaks mid-demo

- Camera won't start → Manual entry tab, paste the token (Step 4.4) — always have Priya's
  fallback token text copied beforehand as insurance, don't rely on reading the QR off a
  screen live.
- Wrong password / locked out → re-run `npm run seed` and `npm run seed:demo`, both are
  idempotent and safe to re-run right before presenting.
- Need a completely fresh PENDING request to approve live instead of the pre-seeded one →
  sign in as `employee1@edc.demo` (`.demo-credentials.local.txt`) and click "Request entry
  for today" yourself, if it doesn't already have one for today.
