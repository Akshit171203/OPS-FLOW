'use client';

import Link from 'next/link';
import { useMe } from '@/lib/me-context';

export default function HomePage() {
  const me = useMe();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Welcome, {me.user.name}</h1>
      <p className="mt-2 text-slate-600">
        Signed in as <strong>{me.user.email}</strong> · {me.organization.name} · {me.role}
      </p>
      <div className="mt-6 flex gap-3 text-sm">
        <Link href="/incidents" className="text-indigo-700 underline">
          View incidents
        </Link>
        <Link href="/services" className="text-indigo-700 underline">
          Manage services
        </Link>
      </div>
    </section>
  );
}
