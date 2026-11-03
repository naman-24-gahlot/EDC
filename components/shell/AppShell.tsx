'use client';

// The signed-in app frame, adapted from 21st.dev "Dashboard Shell" (isaiahbjork): a grouped sidebar
// with an active item lifted on a card and an accent bar, count badges, a collapse-to-icon-rail
// toggle (remembered per browser), a drawer on narrow screens, a header with a breadcrumb, and the
// signed-in person in the footer. Recoloured to IIM Jammu; routes are real pages (Next links), not
// in-component state. Authorization is unchanged: every page still checks its own role.
import { Suspense, use, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type SVGProps } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  BellRing, CalendarDays, CalendarOff, CircleUserRound, DoorOpen, IdCard, Inbox, LayoutDashboard, LogOut, Mail, Menu,
  Network, PanelLeftClose, PanelLeftOpen, QrCode, ScrollText, ShieldCheck, TreePalm, UserPlus, Users, X,
} from 'lucide-react';
import { IimMark } from '@/components/brand/Logos';
import { cn } from '@/lib/utils';

export type ShellCounts = { requests: number; registrations: number; stays: number; leave: number };
type Item = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; count?: keyof ShellCounts; exact?: boolean };
type Group = { label?: string; items: Item[] };

const ADMIN_NAV: Group[] = [
  { label: 'Decisions', items: [
    { href: '/admin', label: 'Access requests', icon: Inbox, count: 'requests', exact: true },
    { href: '/admin/registrations', label: 'Registrations', icon: UserPlus, count: 'registrations' },
    { href: '/admin/leave', label: 'Leave', icon: CalendarOff, count: 'leave' },
    { href: '/admin/stays', label: 'Stay alerts', icon: BellRing, count: 'stays' },
  ] },
  { label: 'People', items: [
    { href: '/admin/people', label: 'People', icon: Users },
    { href: '/admin/hierarchy', label: 'Hierarchy', icon: Network },
    { href: '/admin/visitors', label: 'Visitors', icon: IdCard },
    { href: '/admin/guards', label: 'Guards', icon: ShieldCheck },
  ] },
  { label: 'Gate & events', items: [
    { href: '/admin/entries', label: 'Entries', icon: DoorOpen },
    { href: '/admin/events', label: 'Events', icon: CalendarDays },
    { href: '/admin/holidays', label: 'Holidays', icon: TreePalm },
  ] },
  { label: 'Records', items: [
    { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
    { href: '/admin/outbox', label: 'Emails sent', icon: Mail },
  ] },
  { label: 'You', items: [{ href: '/me', label: 'My account', icon: CircleUserRound, exact: true }] },
];
const memberNav = (isMaster: boolean): Group[] => [
  { items: [
    { href: '/me', label: 'My account', icon: CircleUserRound, exact: true },
    { href: '/me/pass', label: 'My entry pass', icon: QrCode },
  ] },
  ...(isMaster ? [{ label: 'Master', items: [{ href: '/admin', label: 'Admin dashboard', icon: LayoutDashboard }] }] : []),
];

const ROLE_LABEL = { master: 'Master', member: 'Member', guard: 'Guard' } as const;
const COLLAPSE_KEY = 'edc.sidebar.collapsed';
const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-iim-blue/40';

// The collapsed sidebar is remembered per browser (localStorage; if storage is off it just stays open).
const subscribeCollapsed = (cb: () => void) => { window.addEventListener('storage', cb); window.addEventListener(COLLAPSE_KEY, cb); return () => { window.removeEventListener('storage', cb); window.removeEventListener(COLLAPSE_KEY, cb); }; };
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
const writeCollapsed = (on: boolean) => { try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { /* storage off */ } window.dispatchEvent(new Event(COLLAPSE_KEY)); };

export function AppShell({ area, role, user, counts, children }: {
  area: 'admin' | 'member';
  role: 'master' | 'member' | 'guard';
  user: { name: string; email: string | null };
  /** Waiting counts for the badges; streamed, so no page waits on them. */
  counts?: Promise<ShellCounts | null>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = area === 'admin' ? ADMIN_NAV : memberNav(role === 'master');
  const items = nav.flatMap((g) => g.items);
  const isActive = (i: Item) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));
  const activeLabel = items.find(isActive)?.label ?? (area === 'admin' ? 'Admin' : 'My account');

  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggle = () => writeCollapsed(!collapsed);
  const [drawer, setDrawer] = useState(false);
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) { setDrawerPath(pathname); setDrawer(false); } // a link was followed: close the drawer

  const sidebar = (mode: 'rail' | 'drawer') => (
    <SidebarContent mode={mode} collapsed={mode === 'rail' && collapsed} nav={nav} isActive={isActive} role={role} user={user}
      counts={counts} onToggle={toggle} onClose={() => setDrawer(false)} />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh bg-[#F4F7FB] text-[#1B2A38]">
        <aside aria-label="Primary"
          className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-iim-navy/10 bg-[#EEF2F8] transition-[width] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:flex',
            collapsed ? 'w-[64px]' : 'w-[248px]')}>
          {sidebar('rail')}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col" inert={drawer}>
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-iim-navy/10 bg-[#F4F7FB]/85 px-3 backdrop-blur-md sm:px-5">
            <button type="button" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-label="Open navigation"
              className={cn('inline-flex size-9 items-center justify-center rounded-[9px] text-[#46596B] hover:bg-white md:hidden', focusRing)}>
              <Menu className="size-[18px]" aria-hidden />
            </button>
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <li className="hidden truncate text-[#5B6B7B] sm:block">EDC Access</li>
                <li aria-hidden className="hidden text-[#A3AEBB] sm:block">/</li>
                <li aria-current="page" className="truncate font-semibold text-iim-navy">{activeLabel}</li>
              </ol>
            </nav>
            <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1',
              role === 'master' ? 'bg-iim-navy text-white ring-iim-navy' : role === 'guard' ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-iim-sky text-iim-navy ring-iim-blue/25')}>
              {ROLE_LABEL[role]}
            </span>
          </header>
          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1280px] px-3 pb-10 pt-5 sm:px-6 sm:pt-6">{children}</div>
          </main>
        </div>

        <Drawer open={drawer} onClose={() => setDrawer(false)}>{sidebar('drawer')}</Drawer>
      </div>
    </MotionConfig>
  );
}

function SidebarContent({ mode, collapsed, nav, isActive, role, user, counts, onToggle, onClose }: {
  mode: 'rail' | 'drawer'; collapsed: boolean; nav: Group[]; isActive: (i: Item) => boolean; role: 'master' | 'member' | 'guard';
  user: { name: string; email: string | null }; counts?: Promise<ShellCounts | null>; onToggle: () => void; onClose: () => void;
}) {
  return (
    <>
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-iim-navy/10', collapsed ? 'justify-center px-2' : 'px-3')}>
        <span className={cn('flex min-w-0 flex-1 items-center gap-2.5 p-1', collapsed && 'flex-none')} title={collapsed ? 'EDC Access · IIM Jammu' : undefined}>
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-white shadow-[0_1px_2px_rgb(39_58_144/0.15)] ring-1 ring-iim-navy/10"><IimMark className="h-6" /></span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold leading-tight text-iim-navy">EDC Access</span>
              <span className="block truncate text-[11.5px] leading-tight text-[#5B6B7B]">IIM Jammu · {ROLE_LABEL[role]}</span>
            </span>
          )}
        </span>
        {mode === 'drawer' && (
          <button type="button" onClick={onClose} aria-label="Close navigation" className={cn('inline-flex size-8 items-center justify-center rounded-[8px] text-[#46596B] hover:bg-white', focusRing)}>
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto py-3 [scrollbar-width:none]', collapsed ? 'px-2' : 'px-2.5')}>
        {nav.map((group, gi) => (
          <div key={group.label ?? gi} className={cn(gi > 0 && 'mt-5')}>
            {group.label && (collapsed
              ? <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-iim-navy/15" />
              : <h2 className="mb-1.5 px-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#8A97A6]">{group.label}</h2>)}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}
                      className={cn('group relative flex h-9 items-center gap-2.5 rounded-[9px] text-[13.5px] transition-colors duration-150',
                        collapsed ? 'justify-center px-0' : 'px-2.5',
                        active ? 'bg-white font-medium text-iim-navy shadow-[0_1px_2px_rgb(39_58_144/0.08),0_0_0_1px_rgb(39_58_144/0.10)]'
                          : 'text-[#46596B] hover:bg-white/70 hover:text-iim-navy', focusRing)}>
                      {active && <span aria-hidden className={cn('absolute top-2 h-5 w-[3px] rounded-r-full bg-iim-red', collapsed ? '-left-2' : '-left-2.5')} />}
                      <Icon aria-hidden className={cn('size-[17px] shrink-0', active ? 'text-iim-blue' : 'text-[#7C8C9B] group-hover:text-iim-navy')} />
                      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      {item.count && counts && (
                        <Suspense fallback={null}><Badge counts={counts} k={item.count} dot={collapsed} label={item.label} /></Suspense>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('shrink-0 border-t border-iim-navy/10 p-2.5', collapsed && 'px-2')}>
        <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
          <span className={cn('flex min-w-0 items-center gap-2.5 p-1.5', collapsed ? 'flex-none' : 'flex-1')} title={collapsed ? user.name : undefined}>
            <Initials name={user.name} />
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium leading-tight">{user.name}</span>
                {user.email && <span className="block truncate text-[11.5px] leading-tight text-[#5B6B7B]">{user.email}</span>}
              </span>
            )}
          </span>
          <SignOut />
          {mode === 'rail' && (
            <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn('inline-flex size-8 items-center justify-center rounded-[8px] text-[#46596B] hover:bg-white', focusRing)}>
              {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Badge({ counts, k, dot, label }: { counts: Promise<ShellCounts | null>; k: keyof ShellCounts; dot: boolean; label: string }) {
  const n = use(counts)?.[k] ?? 0;
  if (n <= 0) return null;
  return dot
    ? <span aria-label={`${label}: ${n} waiting`} className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500" />
    : <span aria-label={`${n} waiting`} className="rounded-[6px] bg-amber-100 px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-amber-900">{n}</span>;
}

function Initials({ name }: { name: string }) {
  const letters = name.split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-iim-sky text-[11px] font-semibold text-iim-navy ring-1 ring-iim-blue/20">{letters}</span>;
}

function SignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} aria-label="Sign out" title="Sign out"
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/session', { method: 'DELETE' });
        // A full page load: discards the browser's in-memory page cache, so the next person on
        // this device can't see this account's pages.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full load: clears the in-browser page cache between accounts
        window.location.assign('/login');
      }}
      className={cn('inline-flex size-8 items-center justify-center rounded-[8px] text-[#46596B] hover:bg-white hover:text-iim-red disabled:opacity-50', focusRing)}>
      <LogOut className="size-4" aria-hidden />
    </button>
  );
}

/** The narrow-screen drawer: slides in from the left over a dimmed page; Escape or the backdrop closes it. */
function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.div aria-hidden className="absolute inset-0 bg-[#1B2A38]/35" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-[#EEF2F8] shadow-2xl"
            initial={{ transform: 'translateX(-100%)' }} animate={{ transform: 'translateX(0%)' }} exit={{ transform: 'translateX(-100%)' }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
