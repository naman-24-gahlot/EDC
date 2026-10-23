import { formatDateTime, PROFILE_LABEL } from '@/lib/display';
import type { OnCampus } from '@/lib/gate';

// "On campus now": entered today, no exit recorded since. Accurate as long as the gate records
// exits too (Entry / Exit switch on the guard screen).
export function OnCampusPanel({ people }: { people: OnCampus[] }) {
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-3">
      <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 text-sm md:min-h-0">
        <span><b className="text-lg" data-testid="on-campus-count">{people.length}</b> on campus now</span>
        <span className="text-xs text-gray-500">entered today, not recorded leaving</span>
      </summary>
      {people.length === 0 ? <p className="mt-2 text-sm text-gray-400">Nobody right now.</p> : (
        <ul className="mt-2 divide-y divide-gray-100 text-sm">
          {people.map((p) => (
            <li key={p.personId} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{p.name} <span className="text-xs text-gray-500">{p.profileType ? PROFILE_LABEL[p.profileType as keyof typeof PROFILE_LABEL] : ''}{p.eventName ? ` · ${p.eventName}` : ''}</span></span>
              <span className="text-xs text-gray-500">in since {formatDateTime(p.since)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
