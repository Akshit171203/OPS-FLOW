'use client';

import { useId, useState } from 'react';
import * as RS from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** Smaller second line, for example a role or a project */
  hint?: string;
}

/** Radix does not allow an empty string as an item value, so "no selection" travels as this and is mapped back. */
const NONE = '__none__';
const toRadix = (v: string) => (v === '' ? NONE : v);
const fromRadix = (v: string) => (v === NONE ? '' : v);

/**
 * A dropdown that replaces the browser's own <select>: it matches the rest of the UI, opens in a panel that
 * stays inside the screen (it flips and shifts at the edges), and works with the keyboard and screen readers.
 * Give it a `name` and it also takes part in normal form submission; use `value`/`onChange` to control it.
 * An option with value "" is the "nothing chosen" choice (for example "All statuses" or "Unassigned").
 */
export function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  required,
  disabled,
  placeholder = 'Select…',
  'aria-label': ariaLabel,
  className = '',
  width,
  size = 'md',
}: {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  /** Fixed trigger width, for toolbars (Tailwind class such as "w-44") */
  width?: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  const [inner, setInner] = useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const selected = options.find((o) => o.value === current);
  const empty = options.find((o) => o.value === '');

  return (
    <RS.Root
      value={toRadix(current)}
      onValueChange={(v) => {
        const next = fromRadix(v);
        if (!controlled) setInner(next);
        onChange?.(next);
      }}
      name={name}
      required={required}
      disabled={disabled}
    >
      <RS.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`group inline-flex items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface text-left text-sm text-ink shadow-sm transition hover:border-ink-subtle/60 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/25 disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:border-accent-600 data-[placeholder]:text-ink-subtle ${
          size === 'sm' ? 'h-8 px-2.5' : 'h-10 px-3'
        } ${width ?? 'w-full'} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <span className={selected.value === '' && empty ? 'text-ink-muted' : undefined}>
              {selected.label}
            </span>
          ) : (
            <span className="text-ink-subtle">{placeholder}</span>
          )}
        </span>
        <RS.Icon>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          avoidCollisions
          className="z-[80] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line-strong bg-surface text-ink shadow-2xl data-[state=open]:animate-in"
        >
          <RS.Viewport className="p-1.5">
            {options.map((o) => (
              <RS.Item
                key={toRadix(o.value)}
                value={toRadix(o.value)}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium"
              >
                <RS.ItemText>
                  <span className="block truncate">{o.label}</span>
                </RS.ItemText>
                {o.hint && (
                  <span className="ml-auto shrink-0 text-xs text-ink-subtle">{o.hint}</span>
                )}
                <RS.ItemIndicator className="absolute right-2.5 inline-flex items-center text-accent-ink">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
