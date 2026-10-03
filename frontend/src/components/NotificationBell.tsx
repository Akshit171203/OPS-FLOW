'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationDto, Paginated } from '@opsflow/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useFetch } from '@/lib/useFetch';

type NotificationList = Paginated<NotificationDto> & { unreadCount: number };

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const list = useFetch<NotificationList>('/api/notifications?limit=10');
  const unread = list.data?.unreadCount ?? 0;

  useSocketEvent('notification.created', list.reload);
  useReconnect(list.reload);

  async function openNotification(n: NotificationDto) {
    if (!n.readAt)
      await api(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    list.reload();
    setOpen(false);
    if (n.incidentId) router.push(`/incidents/${n.incidentId}`);
  }

  return (
    <div className="relative">
      <button
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded p-2 hover:bg-slate-100"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded border border-slate-200 bg-white shadow-lg">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium">Notifications</p>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-auto">
            {list.data?.items.length === 0 && (
              <li className="p-3 text-sm text-slate-500">Nothing yet.</li>
            )}
            {list.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => openNotification(n)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${n.readAt ? 'text-slate-500' : 'font-medium'}`}
                >
                  <span className="block">{n.message}</span>
                  <span className="block text-xs font-normal text-slate-500">
                    {formatDate(n.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
