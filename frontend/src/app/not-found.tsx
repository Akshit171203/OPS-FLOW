import Link from 'next/link';
import { buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <p aria-hidden="true" className="text-8xl font-semibold tracking-tighter text-ink">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        The page you are looking for does not exist or has moved.
      </p>
      <Link href="/" className={`${buttonClass} mt-6`}>
        Back to the dashboard
      </Link>
    </main>
  );
}
