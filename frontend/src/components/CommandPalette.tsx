'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  AlertTriangle,
  BookOpen,
  CornerDownLeft,
  LayoutDashboard,
  LogOut,
  Moon,
  Plug,
  Plus,
  Search,
  Server,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { roleRank, type IncidentDto, type MeResponse, type Paginated } from '@opsflow/shared';
import { api } from '@/lib/api';
import { SeverityBadge } from './ui';

const item =
  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink';
const group =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-subtle';

/** Cmd/Ctrl+K: jump to a page, an incident, or run a common action. */
export function CommandPalette({
  me,
  open,
  onOpenChange,
  onSignOut,
}: {
  me: MeResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [incidents, setIncidents] = useState<IncidentDto[]>([]);
  const isAdmin = roleRank[me.role] >= roleRank.ADMIN;
  const canCreate = roleRank[me.role] >= roleRank.ENGINEER;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Recent incidents are loaded each time the palette opens so the list is current
  useEffect(() => {
    if (!open) return;
    api<Paginated<IncidentDto>>('/api/incidents?limit=8')
      .then((r) => setIncidents(r.items))
      .catch(() => setIncidents([]));
  }, [open]);

  const go = (href: string) => () => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[14vh] z-[61] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        <Command.Input
          placeholder="Search pages, incidents and actions…"
          className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
        />
        <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle">
          esc
        </kbd>
      </div>
      <Command.List className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-8 text-center text-sm text-ink-muted">
          Nothing found.
        </Command.Empty>

        <Command.Group heading="Go to" className={group}>
          <Command.Item className={item} onSelect={go('/')}>
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Dashboard
          </Command.Item>
          <Command.Item className={item} onSelect={go('/incidents')}>
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Incidents
          </Command.Item>
          <Command.Item className={item} onSelect={go('/services')}>
            <Server className="h-4 w-4" aria-hidden="true" /> Services
          </Command.Item>
          <Command.Item className={item} onSelect={go('/runbooks')}>
            <BookOpen className="h-4 w-4" aria-hidden="true" /> Runbooks
          </Command.Item>
          {isAdmin && (
            <Command.Item className={item} onSelect={go('/integrations')}>
              <Plug className="h-4 w-4" aria-hidden="true" /> Integrations
            </Command.Item>
          )}
        </Command.Group>

        {incidents.length > 0 && (
          <Command.Group heading="Recent incidents" className={group}>
            {incidents.map((i) => (
              <Command.Item
                key={i.id}
                value={`${i.title} ${i.serviceName} ${i.id}`}
                className={item}
                onSelect={go(`/incidents/${i.id}`)}
              >
                <SeverityBadge value={i.severity} />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <span className="hidden shrink-0 text-xs text-ink-subtle sm:block">
                  {i.serviceName}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Actions" className={group}>
          {canCreate && (
            <Command.Item className={item} onSelect={go('/incidents/new')}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New incident
            </Command.Item>
          )}
          <Command.Item
            className={item}
            onSelect={() => {
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
              onOpenChange(false);
            }}
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} theme
          </Command.Item>
          <Command.Item
            className={item}
            onSelect={() => {
              onOpenChange(false);
              onSignOut();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </Command.Item>
        </Command.Group>
      </Command.List>
      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-ink-subtle">
        <span>↑↓ to move</span>
        <span className="inline-flex items-center gap-1">
          <CornerDownLeft className="h-3 w-3" aria-hidden="true" /> to open
        </span>
      </div>
    </Command.Dialog>
  );
}
