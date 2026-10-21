# Demo Script

Click-by-click sequence for presenting the system. ~10 minutes end to end.
Live URL: `https://edc-gib-24.vercel.app` (or `npm run dev` → `http://localhost:3000`).

## Before you start

1. **Fresh data:** `npm run reset:seed -- --yes-i-mean-it` (destructive — wipes and reseeds the
   shared Firebase project the live site uses). Request ages and short grants are relative to
   when the seed runs, so re-seed on the day you present.
2. **Passwords** are in `.demo-credentials.local.txt` (gitignored, on your machine only — every
   reseed generates new ones). Keep it open in another window. Every account can sign in with
   its **username** or its **email**, same password.
3. **Two browsers / one incognito window** make the role switches faster.
4. For the gate, open `/guard` on a phone so the camera has a real device. Without a camera,
   use **Type a code** — it's the same server check, not a weaker fallback.

## Cast (from the seed — the spec's own hierarchy example)

| Who | Username | Code | Role in the demo |
|---|---|---|---|
| Master Admin | `master` | EDC… | Approves, manages everyone, changes profile types |
| Rahul Sharma | `rahul` | `EDC25166` | Employee 1 — parent of Suresh, Anita, Vikram, Priya |
| Neha Kapoor | `neha` | EDC… | Employee 2 — parent of Ramesh and Karan |
| Vikram Singh | `vikram.singh` | BDG… | Rahul's bodyguard — has a **pending** request in Rahul's queue |
| Karan Mehta | `karan.mehta` | GUE… | Neha's guest — pending request, **no access yet** |
| Ramesh Yadav | `ramesh.yadav` | DRV… | Neha's driver — a 4-day-old request that has **expired** |
| Meera Joshi | `meera.joshi` | — | Registered, **pending approval** |
| Gate Guard | `guard1` | — | The gate |

## 1 — Registration (public link, no account needed)

1. Open `/register`. Fill name, username, email, mobile, password, purpose; choose
   **Driver**; enter `rahul` (or `EDC25166`) as the controlling employee. Submit.
2. Point out: "Registration submitted — pending approval." No government ID is collected —
   that's deliberately a later, separate integration.

## 2 — Approval → persistent profile → access code (as Rahul)

1. Sign in as `rahul`. You land on **/me**: Profile, Access, My requests, **People under me**.
2. Under "Registrations to decide", **Approve** the driver you just registered. They get a
   `DRV` + 5-digit code immediately and appear in Rahul's list.
3. Point out the list: only Rahul's own people. Neha's people (Ramesh, Karan) are not
   filtered out in the browser — the server never sends them.

## 3 — Request → entitlement (still Rahul)

1. Vikram's request is in **Access requests to decide**. **Approve** it. Vikram turns
   **ACTIVE** — a bodyguard gets Mon–Sat 08:00–20:00 for 30 days (his profile's template).
2. Next to the new driver (no access yet), click **Give usual access** — same template, no request
   needed because Rahul is their approver.
3. Optional: **Create person under me** → a relative, approved on the spot with a `REL` code and
   a one-time password shown once.

## 4 — The Entry Pass (as Rahul, or anyone ACTIVE)

1. **Open my entry pass** → `/me/pass`: name, profile, **ACTIVE**, a large QR, the access code in
   big monospace, valid-till / days / hours, "Present this pass at the gate."
2. Reload — the QR is identical. It's tied to the person, not to a day or a request: the same
   pass works every day access allows.
3. Sign in as `karan.mehta` and open the pass: **NONE**, no QR — he has no access yet.

## 5 — The gate (as guard1, ideally on a phone)

1. **Camera scan** → hold Rahul's pass up → **ENTRY APPROVED** with name, photo, profile type.
   (Or **Type a code** → `EDC25166`.) If it's outside Mon–Fri 09:00–17:00, Rahul gets
   **ENTRY DENIED — Outside permitted hours**: the rules are live, not cosmetic.
2. Scan / type it again → still approved. **Nothing is consumed by entering.**
3. Type Karan's code → **DENIED — No active access**. Type a made-up code → **Invalid access code**.
4. Turn off Wi-Fi on the guard device and try again → grey **VERIFICATION UNAVAILABLE — Do not
   admit**. It never shows green when it can't reach the server.

## 6 — Master (as master → /admin)

1. **Requests:** Karan's request is PENDING (controller: Neha); Ramesh's shows **EXPIRED** — it
   left every queue after 3 days but is still in history. Approve Karan.
2. **People → Suresh Kumar:** change **Driver → Relative**. His code changes from `DRV…` to
   `REL…` (same digits); the old code is now **Code superseded** at the gate, his old QR stops
   working, and his access becomes the **Relative default** (the page says exactly what it will be
   before you press **Save changes**). Profile history records it. Adjust his period in the
   **Access period** form and press **Save changes** — same pass, applies at the gate at once.
3. **Revoke** someone's access on their page → their code says **Access revoked**, their QR
   **Invalid QR**.
4. **Hierarchy** shows Master → employees → their people. **Entries** shows every gate attempt.
   **Audit log** shows every action above, with who did it.
5. **Guards:** create a guard; they sign in and land on the gate.

## 7 — Scoping, the one-line version

Sign in as `neha`: she sees Ramesh and Karan only. Ask her to approve Vikram's request by URL —
the server refuses (403). Authority comes from the hierarchy, checked on the server for every
action; the UI just reflects it.

## If something breaks mid-demo

- Camera won't start → **Type a code** (same server check).
- Wrong password / stale data → reseed (step 0) — passwords change every reseed.
- A request "disappeared" → it probably expired (3 days); it's under **Requests → EXPIRED**.
