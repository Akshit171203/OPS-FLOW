'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MeResponse } from '@opsflow/shared';
import { useDismiss } from '@/lib/useDismiss';
import { Icon } from '../Icon';
import { NotificationBell } from '../NotificationBell';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
  { href: '/incidents', label: 'Incidents', icon: 'incidents' },
  { href: '/services', label: 'Services', icon: 'services' },
  { href: '/runbooks', label: 'Runbooks', icon: 'runbooks' },
] as const;

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 px-4 py-4 text-lg font-semibold tracking-tight text-ink"
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-md bg-accent-600 text-sm font-bold text-white"
      >
        O
      </span>
      OpsFlow
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-1 px-2">
      {NAV.map((item) => {
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
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
              active
                ? 'bg-accent-50 text-accent-800'
                : 'text-ink-muted hover:bg-slate-100 hover:text-ink'
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function OrgFooter({ me }: { me: MeResponse }) {
  return (
    <div className="border-t border-line px-4 py-3">
      <p className="truncate text-sm font-medium text-ink">{me.organization.name}</p>
      <p className="text-xs text-ink-muted">{me.role.charAt(0) + me.role.slice(1).toLowerCase()}</p>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

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
        className="flex items-center gap-2 rounded-md p-1.5 hover:bg-slate-100"
      >
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-800"
        >
          {initials(me.user.name)}
        </span>
        <span className="hidden text-sm font-medium text-ink sm:block">{me.user.name}</span>
        <Icon name="chevron" className="hidden h-4 w-4 text-ink-subtle sm:block" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm font-medium">{me.user.name}</p>
            <p className="truncate text-xs text-ink-muted">{me.user.email}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {me.organization.name} · {me.role}
            </p>
          </div>
          <button
            role="menuitem"
            onClick={onSignOut}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
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
  const [navOpen, setNavOpen] = useState(false);
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
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        <NavLinks />
        <OrgFooter me={me} />
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                ref={closeRef}
                onClick={() => setNavOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 hover:bg-slate-100"
              >
                <Icon name="close" />
              </button>
            </div>
            <NavLinks onNavigate={() => setNavOpen(false)} />
            <OrgFooter me={me} />
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-6">
          <button
            ref={openerRef}
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="rounded-md p-2 hover:bg-slate-100 lg:hidden"
          >
            <Icon name="menu" />
          </button>
          <Link href="/" className="font-semibold tracking-tight lg:hidden">
            OpsFlow
          </Link>
          <div className="flex-1" />
          <NotificationBell />
          <UserMenu me={me} onSignOut={onSignOut} />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
