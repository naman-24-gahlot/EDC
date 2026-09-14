'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Pending' },
  { href: '/admin/employees', label: 'Employees' },
  { href: '/admin/history', label: 'History' },
  { href: '/admin/audit', label: 'Audit log' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-gray-200">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-3 py-2 text-sm font-medium ${
              active
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
