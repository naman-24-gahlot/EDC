'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Requests' },
  { href: '/admin/registrations', label: 'Registrations' },
  { href: '/admin/people', label: 'People' },
  { href: '/admin/hierarchy', label: 'Hierarchy' },
  { href: '/admin/entries', label: 'Entries' },
  { href: '/admin/audit', label: 'Audit log' },
  { href: '/admin/guards', label: 'Guards' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-gray-200">
      {LINKS.map((link) => {
        const active = link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${
              active ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
