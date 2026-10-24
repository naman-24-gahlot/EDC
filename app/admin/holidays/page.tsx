import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { InfoTip } from '@/components/InfoTip';
import { PROFILE_LABEL, formatDate } from '@/lib/display';
import { todayDateString } from '@/lib/date';
import { listHolidays } from '@/lib/holidays';
import { requireMasterPage } from '../data';
import { HolidayForm, RemoveHoliday } from './HolidayForm';

export const dynamic = 'force-dynamic';

export default async function HolidaysPage() {
  await requireMasterPage();
  const holidays = await listHolidays();
  const today = todayDateString();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-medium text-gray-500">
          Campus holidays
          <InfoTip label="About holidays">On a holiday the gate answers “Campus holiday” for the groups you tick, whatever their usual days and hours. Employees’ own leave is separate (Leave tab).</InfoTip>
        </h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      <HolidayForm />
      {holidays.length === 0 ? <p className="text-sm text-gray-400">No holidays added.</p> : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm" data-testid="holiday-list">
          {holidays.map((h) => (
            <li key={h.date} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${h.date < today ? 'text-gray-400' : ''}`}>
              <span><b>{formatDate(h.date)}</b> — {h.name}{h.date === today && <b className="ml-1 rounded bg-amber-100 px-1 text-[11px] text-amber-900">today</b>}
                <span className="block text-xs text-gray-500">closed for {h.appliesTo.map((t) => PROFILE_LABEL[t]).join(', ')}</span></span>
              {h.date >= today && <RemoveHoliday date={h.date} name={h.name} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
