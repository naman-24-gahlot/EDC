import { NextResponse } from 'next/server';
import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';

// Not a route — this is a private folder (app/api/admin/_lib), excluded from routing.
// Shared by approve/reject/revoke: same "read status, validate legal transition,
// write new status + audit log atomically" shape for all three.

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type AuditAction = 'APPROVED' | 'REJECTED' | 'REVOKED';

interface TransitionOptions {
  requestId: string;
  admin: SessionUser;
  fromStatuses: string[];
  toStatus: 'APPROVED' | 'REJECTED' | 'REVOKED';
  auditAction: AuditAction;
  extraFields?: (data: DocumentData, now: Timestamp) => Record<string, unknown>;
  auditDetails?: string | null;
}

/** Runs a validated request state transition + its audit log write atomically. */
export async function runRequestTransition(opts: TransitionOptions): Promise<NextResponse> {
  const requestRef = adminDb.collection('requests').doc(opts.requestId);
  const auditRef = adminDb.collection('auditLogs').doc();

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new HttpError(404, 'Request not found');
      }
      const data = snap.data() as DocumentData;
      if (!opts.fromStatuses.includes(data.status)) {
        throw new HttpError(
          409,
          `Cannot move a request from ${data.status} to ${opts.toStatus}`
        );
      }

      const now = Timestamp.now();
      const extra = opts.extraFields ? opts.extraFields(data, now) : {};

      tx.update(requestRef, {
        status: opts.toStatus,
        reviewedBy: opts.admin.uid,
        reviewedAt: now,
        ...extra,
      });
      tx.set(auditRef, {
        logId: auditRef.id,
        action: opts.auditAction,
        requestId: opts.requestId,
        actorId: opts.admin.uid,
        actorRole: 'admin',
        targetEmployeeId: data.employeeId,
        timestamp: now,
        details: opts.auditDetails ?? null,
      });
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`Failed to transition request ${opts.requestId} to ${opts.toStatus}`, err);
    return NextResponse.json({ error: 'Could not update request' }, { status: 500 });
  }

  return NextResponse.json({ requestId: opts.requestId, status: opts.toStatus });
}
