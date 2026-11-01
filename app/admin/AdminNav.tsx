'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MotionConfig, motion } from 'motion/react';

const LINKS = [
  { href: '/admin', label: 'Access requests', count: 'requests' },
  { href: '/admin/registrations', label: 'Registrations', count: 'registrations' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/people', label: 'People' },
  { href: '/admin/hierarchy', label: 'Hierarchy' },
  { href: '/admin/visitors', label: 'Visitors' },
  { href: '/admin/entries', label: 'Entries' },
  { href: '/admin/stays', label: 'Stay alerts', count: 'stays' },
  { href: '/admin/leave', label: 'Leave', count: 'leave' },
  { href: '/admin/holidays', label: 'Holidays' },
  { href: '/admin/audit', label: 'Audit log' },
  { href: '/admin/guards', label: 'Guards' },
] as const;

export function AdminNav({ counts }: { counts: { requests: number; registrations: number; stays: number; leave: number } }) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const current = LINKS.find((l) => isActive(l.href))?.href ?? '/admin';
  const waiting = (link: (typeof LINKS)[number]) => ('count' in link ? counts[link.count] : 0);

  return (
    <>
    {/* Phones: 13 sections don't fit across, and a sideways strip hides most of them — a menu shows all. */}
    <label className="block md:hidden">
      <span className="sr-only">Go to section</span>
      <select value={current} onChange={(e) => router.push(e.target.value)} data-testid="admin-menu"
        className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-900">
        {LINKS.map((link) => (
          <option key={link.href} value={link.href}>{link.label}{waiting(link) > 0 ? ` (${waiting(link)} waiting)` : ''}</option>
        ))}
      </select>
    </label>
    {/* The underline glides to the chosen tab (shared layout animation); off for reduced motion. */}
    <MotionConfig reducedMotion="user">
    <nav className="hidden gap-1 overflow-x-auto border-b border-gray-200 md:flex">
      {LINKS.map((link) => {
        const active = link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);
        const n = 'count' in link ? counts[link.count] : 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors duration-150 ${
              active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {active && <motion.span layoutId="admin-tab" aria-hidden className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-iim-navy" transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }} />}
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
    </MotionConfig>
    </>
  );
}
