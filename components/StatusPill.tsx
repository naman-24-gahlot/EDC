import { STATUS_STYLE } from '@/lib/display';

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1 ${STATUS_STYLE[status] ?? STATUS_STYLE.NONE}`}>
      {status}
    </span>
  );
}
