'use client';

import { useMe } from '@/lib/me-context';

export default function HomePage() {
  const me = useMe();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Welcome, {me.user.name}</h1>
      <p className="mt-2 text-slate-600">
        Signed in as <strong>{me.user.email}</strong> · {me.organization.name} · {me.role}
      </p>
    </section>
  );
}
