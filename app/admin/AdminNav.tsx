'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Requests', count: 'requests' },
  { href: '/admin/registrations', label: 'Registrations', count: 'registrations' },
  { href: '/admin/people', label: 'People' },
  { href: '/admin/hierarchy', label: 'Hierarchy' },
  { href: '/admin/entries', label: 'Entries' },
  { href: '/admin/audit', label: 'Audit log' },
  { href: '/admin/guards', label: 'Guards' },
] as const;

export function AdminNav({ counts }: { counts: { requests: number; registrations: number } }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-gray-200">
      {LINKS.map((link) => {
        const active = link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);
        const n = 'count' in link ? counts[link.count] : 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium ${
              active ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {link.label}
            {n > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={`${n} waiting`}>
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
