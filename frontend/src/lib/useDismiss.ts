'use client';

import { useEffect, type RefObject } from 'react';

/** Close a popup on Escape or on a click outside it. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onClick = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [ref, open, onClose]);
}
