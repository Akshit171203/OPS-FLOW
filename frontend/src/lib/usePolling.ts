'use client';

import { useEffect, useRef } from 'react';

/** Call `fn` every `ms` while `active` is true (for things with no push event, like indexing status). */
export function usePolling(active: boolean, fn: () => void, ms = 2000) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => latest.current(), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}
