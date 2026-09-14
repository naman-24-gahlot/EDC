# Database Schema — Firestore

All writes happen server-side via Route Handlers using the Firebase Admin SDK (see
[SECURITY_MODEL.md](SECURITY_MODEL.md)). Client SDK is used for reads only, scoped by
Firestore rules.

## Collections

### `users/{uid}`
Display/management mirror of the account. **Role authorization never reads from here** —
it reads from the custom claim on the Firebase ID token. This doc is for admin UI listing
and display name lookups only.

```
{
  uid: string,                    // == Firebase Auth uid, == doc id
  email: string,
  displayName: string,
  role: 'employee' | 'admin' | 'guard',   // mirrors the custom claim; kept in sync on creation
  active: boolean,                // admin can deactivate a temporary employee
  createdAt: Timestamp,
  createdBy: string,              // uid of the admin who created this account
}
```

### `requests/{requestId}`
One access request per employee per day. `requestId` is deterministic:
`{employeeUid}_{YYYY-MM-DD}` — this makes "one request per day" a database-level
invariant (a second create for the same day is a doc-already-exists conflict), not just an
application check.

```
{
  requestId: string,              // == doc id, == `${employeeUid}_${date}`
  employeeId: string,             // uid
  employeeName: string,           // denormalized for admin list display
  date: string,                   // 'YYYY-MM-DD', server-computed at creation, not client-supplied
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'CHECKED_IN',
  requestedAt: Timestamp,

  reviewedBy: string | null,      // admin uid
  reviewedAt: Timestamp | null,
  reviewNote: string | null,

  // Set when status -> APPROVED. Used to build and verify the QR token (see
  // SECURITY_MODEL.md). passNonce becomes invalid the moment status leaves APPROVED.
  passNonce: string | null,
  passIssuedAt: Timestamp | null,

  checkedInBy: string | null,     // guard uid
  checkedInAt: Timestamp | null,
}
```

Note: `EXPIRED` is not a stored status. An `APPROVED` request whose `date` is not today is
treated as expired wherever it's read or verified — computed, not written. This avoids
needing a cron job in the prototype.

### `auditLogs/{logId}`
Append-only. No role may update or delete an entry, including admins.

```
{
  logId: string,                  // auto-generated
  action: 'REQUEST_CREATED' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'CHECKED_IN' |
          'CHECK_IN_DENIED' | 'EMPLOYEE_ADDED' | 'EMPLOYEE_DEACTIVATED',
  requestId: string | null,       // null for employee-management actions (not request-scoped)
  actorId: string,                // uid performing the action
  actorRole: 'employee' | 'admin' | 'guard',
  targetEmployeeId: string | null, // null when a denied scan doesn't resolve to a known employee
  timestamp: Timestamp,
  details: string | null,         // e.g. denial reason for CHECK_IN_DENIED, reviewNote for REJECTED/REVOKED
}
```

`CHECK_IN_DENIED` is logged too (not just successes) — a rejected/expired/forged scan
attempt is exactly the kind of event an audit trail exists to catch.

`EMPLOYEE_ADDED`/`EMPLOYEE_DEACTIVATED` (added in the Admin Workflow session) extend the
same audit trail to temporary-employee account management, since that's as
security-relevant as request state changes and the project's audit requirement isn't
limited to the request state machine specifically.

## State machine

| From | To | Who | Where enforced |
|---|---|---|---|
| — | `PENDING` | Employee | Route Handler: rejects if today's `requestId` already exists |
| `PENDING` | `APPROVED` | Admin | Route Handler: sets `passNonce`/`passIssuedAt`, writes audit log |
| `PENDING` | `REJECTED` | Admin | Route Handler: writes audit log |
| `APPROVED` | `REVOKED` | Admin | Route Handler: clears `passNonce`, writes audit log |
| `APPROVED` (today, valid nonce) | `CHECKED_IN` | Guard | Route Handler, inside a Firestore **transaction** (prevents double check-in on concurrent scans), writes audit log |
| `APPROVED` (date != today) | *(treated as expired, no write)* | System | Computed at read/verify time |

Terminal states: `REJECTED`, `REVOKED`, `CHECKED_IN`. No transitions out of these.

Illegal transitions (e.g. approving a `REVOKED` request) are rejected by the Route Handler
with a clear error — never silently allowed.
