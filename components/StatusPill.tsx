import { STATUS_STYLE } from '@/lib/display';

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-semibold tracking-wide ring-1 ring-inset ${STATUS_STYLE[status] ?? STATUS_STYLE.NONE}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />{status}
    </span>
  );
}
