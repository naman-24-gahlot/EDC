import { adminDb } from '@/lib/firebase/admin';
import { AddEmployeeForm } from './AddEmployeeForm';
import { DeactivateButton } from './DeactivateButton';

interface EmployeeRecord {
  uid: string;
  email: string;
  displayName: string;
  active: boolean;
  createdAt: string;
}

export default async function AdminEmployeesPage() {
  const snap = await adminDb.collection('users').where('role', '==', 'employee').get();

  const employees: EmployeeRecord[] = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        email: data.email as string,
        displayName: data.displayName as string,
        active: data.active !== false,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? '',
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="space-y-6">
      <AddEmployeeForm />

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500">
          Temporary employees ({employees.length})
        </h2>
        {employees.length === 0 ? (
          <p className="text-sm text-gray-400">No employees yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200">
            {employees.map((emp) => (
              <li key={emp.uid} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{emp.displayName}</p>
                  <p className="text-xs text-gray-500">{emp.email}</p>
                </div>
                {emp.active ? (
                  <DeactivateButton uid={emp.uid} />
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Deactivated
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
