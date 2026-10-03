'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationDto, Paginated } from '@opsflow/shared';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useDismiss } from '@/lib/useDismiss';
import { useFetch } from '@/lib/useFetch';
import { Icon } from './Icon';

type NotificationList = Paginated<NotificationDto> & { unreadCount: number };

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const list = useFetch<NotificationList>('/api/notifications?limit=10');
  const unread = list.data?.unreadCount ?? 0;
  useSocketEvent('notification.created', list.reload);
  useReconnect(list.reload);

  async function openNotification(n: NotificationDto) {
    setOpen(false);
    if (!n.readAt)
      await api(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    list.reload();
    if (n.incidentId) router.push(`/incidents/${n.incidentId}`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-2 text-ink-muted hover:bg-slate-100 hover:text-ink"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-sev1-fg px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-3 py-2 text-sm font-semibold">Notifications</p>
          {list.error ? (
            <p className="p-3 text-sm text-danger-fg">Could not load notifications.</p>
          ) : list.data?.items.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">You are all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-auto">
              {list.data?.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => openNotification(n)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-accent-600'}`}
                    />
                    <span className="min-w-0">
                      <span
                        className={`block text-sm ${n.readAt ? 'text-ink-muted' : 'font-medium text-ink'}`}
                      >
                        {n.message}
                      </span>
                      <span className="block text-xs text-ink-subtle">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
