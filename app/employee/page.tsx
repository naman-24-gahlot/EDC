import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import type { QueryDocumentSnapshot, DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';
import { signPassToken } from '@/lib/qr-token';
import { RoleHeader } from '@/components/RoleHeader';
import { RequestEntryForm } from './RequestEntryForm';
import { StatusBadge, StatusCard } from './StatusDisplay';

interface RequestRecord {
  requestId: string;
  date: string;
  status: string;
  reviewNote: string | null;
  checkedInAt: string | null;
  passNonce: string | null;
}

function serializeRequest(
  doc: QueryDocumentSnapshot | DocumentSnapshot
): RequestRecord {
  const data = doc.data() ?? {};
  return {
    requestId: doc.id,
    date: data.date,
    status: data.status,
    reviewNote: data.reviewNote ?? null,
    checkedInAt: data.checkedInAt?.toDate?.().toISOString() ?? null,
    passNonce: data.passNonce ?? null,
  };
}

export default async function EmployeeHomePage() {
  const user = await getSessionUser();
  // Belt-and-suspenders — app/employee/layout.tsx already redirects unauthenticated
  // or wrong-role sessions before this page ever renders.
  if (!user || user.role !== 'employee') redirect('/login');

  const today = todayDateString();
  const todayRef = adminDb.collection('requests').doc(`${user.uid}_${today}`);

  const [todaySnap, ownRequestsSnap] = await Promise.all([
    todayRef.get(),
    adminDb.collection('requests').where('employeeId', '==', user.uid).limit(50).get(),
  ]);

  const todayRequest = todaySnap.exists ? serializeRequest(todaySnap) : null;

  // Sorted in application code rather than via Firestore orderBy, so this query
  // doesn't need a composite index for a prototype-sized dataset.
  const history = ownRequestsSnap.docs
    .filter((doc) => doc.id !== todaySnap.id)
    .map(serializeRequest)
    .sort((a, b) => b.date.localeCompare(a.date));

  let passToken: string | null = null;
  let passQrDataUrl: string | null = null;
  if (todayRequest?.status === 'APPROVED' && todayRequest.passNonce) {
    passToken = signPassToken(todayRequest.requestId, todayRequest.passNonce);
    passQrDataUrl = await QRCode.toDataURL(passToken, { margin: 1, width: 240 });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <RoleHeader role="employee" subtitle={user.email ?? undefined} />

      <section className="space-y-3">
        {todayRequest ? <StatusCard request={todayRequest} /> : <RequestEntryForm />}
      </section>

      {todayRequest?.status === 'APPROVED' && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500">Your pass</h2>
          <div className="flex flex-col items-center gap-4 rounded border border-gray-200 p-6">
            {passQrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL, not a static/remote asset next/image handles
              <img src={passQrDataUrl} alt="Entry pass QR code" width={240} height={240} />
            )}
            <div className="w-full space-y-1">
              <p className="text-xs text-gray-500">Manual fallback token (show this if the scan fails)</p>
              <p className="break-all rounded bg-gray-50 px-2 py-1.5 font-mono text-xs">
                {passToken}
              </p>
            </div>
          </div>
        </section>
      )}

      {todayRequest?.status === 'CHECKED_IN' && (
        <p className="text-sm text-green-700">
          Checked in
          {todayRequest.checkedInAt
            ? ` at ${new Date(todayRequest.checkedInAt).toLocaleTimeString('en-IN')}`
            : ''}
          .
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">No past requests yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200">
            {history.map((r) => (
              <li
                key={r.requestId}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span>{r.date}</span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
