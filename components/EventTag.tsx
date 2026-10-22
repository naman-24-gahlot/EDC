import Link from 'next/link';

/** "Event · <name>" chip for anyone who registered through an event link. */
export function EventTag({ id, name, link = true }: { id: string; name: string; link?: boolean }) {
  const cls = 'inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200';
  const body = <><span aria-hidden>◆</span>{name}</>;
  return link ? <Link href={`/admin/events/${id}`} className={`${cls} hover:bg-violet-100`} title="Registered through this event's link">{body}</Link> : <span className={cls}>{body}</span>;
}
