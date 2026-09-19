import { adminDb } from '@/lib/firebase/admin';
import { RegistrationActions } from './RegistrationActions';

interface RegistrationRow {
  personId: string;
  name: string;
  username: string;
  profileType: string | null;
  registrationStatus: string;
  createdAt: string;
}

export default async function AdminRegistrationsPage() {
  // Single-field `in` query — no composite index needed (no orderBy, no second filter).
  const snap = await adminDb
    .collection('people')
    .where('registrationStatus', 'in', ['PENDING', 'REJECTED'])
    .get();

  const people: RegistrationRow[] = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        personId: doc.id,
        name: `${data.firstName} ${data.lastName}`,
        username: data.username as string,
        profileType: (data.profileType as string | null) ?? null,
        registrationStatus: data.registrationStatus as string,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? '',
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500">Registrations ({people.length})</h2>

      {people.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing pending or rejected.</p>
      ) : (
        <ul className="space-y-3">
          {people.map((p) => (
            <li key={p.personId} className="rounded border border-gray-200 p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">
                  {p.name} <span className="text-xs text-gray-400">@{p.username}</span>
                </p>
                <p className="text-xs text-gray-500">
                  {p.profileType ?? '—'} · {p.registrationStatus}
                </p>
              </div>
              <RegistrationActions personId={p.personId} status={p.registrationStatus} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
