'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Info, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { MeResponse } from '@opsflow/shared';
import { useSocketConnected } from '@/lib/socket';
import { useDismiss } from '@/lib/useDismiss';
import { CommandPalette } from '../CommandPalette';
import { Icon } from '../Icon';
import { LogoMark } from '../LogoMark';
import { NotificationBell } from '../NotificationBell';
import { ThemeToggle } from '../ThemeToggle';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
  { href: '/incidents', label: 'Incidents', icon: 'incidents' },
  { href: '/services', label: 'Services', icon: 'services' },
  { href: '/runbooks', label: 'Runbooks', icon: 'runbooks' },
  { href: '/integrations', label: 'Integrations', icon: 'plug', adminOnly: true },
] as const;

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 px-4 py-5 text-[17px] font-semibold tracking-tight text-ink"
    >
      <LogoMark size={32} />
      OpsFlow
    </Link>
  );
}

function NavLinks({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 px-3">
      <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        Workspace
      </p>
      {NAV.filter((item) => !('adminOnly' in item) || isAdmin).map((item) => {
        const active =
          'exact' in item && item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-surface-2 ring-1 ring-inset ring-line-strong/60"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            {active && (
              <span
                aria-hidden="true"
                className="absolute -left-3 top-2 h-5 w-[3px] rounded-r-full bg-gradient-to-b from-accent-600 to-[#8b5cf6]"
              />
            )}
            <Icon
              name={item.icon}
              className={`relative h-[18px] w-[18px] transition-colors ${active ? 'text-accent-ink' : 'group-hover:text-ink'}`}
            />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

const Avatar = ({ name, className = 'h-8 w-8 text-xs' }: { name: string; className?: string }) => (
  <span
    aria-hidden="true"
    className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-600 to-[#8b5cf6] font-semibold text-white ${className}`}
  >
    {initials(name)}
  </span>
);

function OrgFooter({ me }: { me: MeResponse }) {
  return (
    <div className="m-3 flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-sm font-semibold text-accent-ink ring-1 ring-line-strong"
      >
        {me.organization.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{me.organization.name}</p>
        <p className="text-xs text-ink-subtle">
          {me.role.charAt(0) + me.role.slice(1).toLowerCase()}
        </p>
      </div>
    </div>
  );
}

function UserMenu({ me, onSignOut }: { me: MeResponse; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${me.user.name}`}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-surface-2"
      >
        <Avatar name={me.user.name} />
        <span className="hidden text-sm font-medium text-ink sm:block">{me.user.name}</span>
        <Icon name="chevron" className="hidden h-4 w-4 text-ink-subtle sm:block" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-40 mt-2 w-64 origin-top-right rounded-xl border border-line-strong bg-surface p-1.5 shadow-2xl"
          >
            <div className="border-b border-line px-3 py-2.5">
              <p className="truncate text-sm font-medium">{me.user.name}</p>
              <p className="truncate text-xs text-ink-muted">{me.user.email}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {me.organization.name} · {me.role}
              </p>
            </div>
            <button
              role="menuitem"
              onClick={onSignOut}
              className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LiveIndicator() {
  const live = useSocketConnected();
  return (
    <span
      role="status"
      className="hidden items-center gap-2 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-muted md:inline-flex"
    >
      <span aria-hidden="true" className="relative inline-flex h-2 w-2">
        {live && (
          <span className="absolute inset-0 rounded-full bg-dot-ok opacity-60 motion-safe:animate-ping-slow" />
        )}
        <span className={`relative h-2 w-2 rounded-full ${live ? 'bg-dot-ok' : 'bg-dot-idle'}`} />
      </span>
      {live ? 'Live' : 'Connecting…'}
    </span>
  );
}

export function AppShell({
  me,
  onSignOut,
  children,
}: {
  me: MeResponse;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = me.role === 'OWNER' || me.role === 'ADMIN';
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // close the drawer after navigating, and on Escape; return focus to the button that opened it
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false);
        openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface/70 backdrop-blur-xl lg:flex">
        <Brand />
        <NavLinks isAdmin={isAdmin} />
        <OrgFooter me={me} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {navOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setNavOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-2xl"
            >
              <div className="flex items-center justify-between pr-2">
                <Brand />
                <button
                  ref={closeRef}
                  onClick={() => setNavOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-lg p-2 hover:bg-surface-2"
                >
                  <Icon name="close" />
                </button>
              </div>
              <NavLinks isAdmin={isAdmin} onNavigate={() => setNavOpen(false)} />
              <OrgFooter me={me} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/70 px-3 backdrop-blur-xl sm:px-6">
          <button
            ref={openerRef}
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="rounded-lg p-2 hover:bg-surface-2 lg:hidden"
          >
            <Icon name="menu" />
          </button>
          <Link href="/" className="font-semibold tracking-tight lg:hidden">
            OpsFlow
          </Link>

          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="group ml-1 hidden h-9 w-full max-w-sm items-center gap-2.5 rounded-lg border border-line bg-surface/60 px-3 text-sm text-ink-subtle transition hover:border-line-strong hover:text-ink-muted sm:flex"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>

          <div className="flex-1" />
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-2 sm:hidden"
          >
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <LiveIndicator />
          <ThemeToggle />
          <NotificationBell />
          <UserMenu me={me} onSignOut={onSignOut} />
        </header>

        {me.demo && (
          <div
            role="note"
            className="flex items-center justify-center gap-2 border-b border-notice-line bg-notice-bg px-4 py-2 text-center text-sm text-notice-fg sm:px-6"
          >
            <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Public demo.</strong> The data is shared with other visitors and resets
              regularly. Settings such as API keys, members and runbooks are read-only here.
            </span>
          </div>
        )}

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>

      <CommandPalette
        me={me}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSignOut={onSignOut}
      />
    </div>
  );
}
