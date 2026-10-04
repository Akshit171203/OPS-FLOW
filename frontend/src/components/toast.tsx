'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError } from '@/lib/api';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  error: (messageOrError: unknown, fallback?: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const styles: Record<Kind, string> = {
  success: 'border-success-line bg-success-bg text-success-fg',
  error: 'border-danger-line bg-danger-bg text-danger-fg',
  info: 'border-line bg-surface text-ink',
};
const LIFETIME_MS: Record<Kind, number> = { success: 4000, info: 4000, error: 8000 };
const MAX_VISIBLE = 4;

/** Turn anything thrown into a short message a person can act on. */
export function messageOf(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (typeof err === 'string') return err;
  if (err instanceof ApiError) return err.message;
  return fallback;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback(
    (id: number) => setItems((cur) => cur.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = nextId.current++;
      setItems((cur) => [...cur.slice(-(MAX_VISIBLE - 1)), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      info: (m) => push('info', m),
      error: (e, fallback) => push('error', messageOf(e, fallback)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* One polite live region; errors inside it are also role=alert so they are announced immediately */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${styles[item.kind]}`}
    >
      <KindIcon kind={item.kind} />
      <p className="flex-1">{item.message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 rounded p-0.5 opacity-70 hover:opacity-100"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.div>
  );
}

function KindIcon({ kind }: { kind: Kind }) {
  const cls = 'mt-0.5 h-4 w-4 shrink-0';
  if (kind === 'success') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (kind === 'error') return <AlertCircle className={cls} aria-hidden="true" />;
  return <Info className={cls} aria-hidden="true" />;
}
