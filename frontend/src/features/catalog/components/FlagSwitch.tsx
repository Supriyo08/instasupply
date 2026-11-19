import { useState } from 'react';

import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/firebase/callables';

import type { ProductRecord } from '../hooks';
import { setProductFlag } from '../mutations';

/**
 * Bare switch with the same look as the form `Toggle`, for dense rows where a column names it.
 * `busy` uses aria-disabled rather than `disabled`, so keyboard focus stays on the switch.
 */
export function Switch({
  checked,
  onChange,
  label,
  busy = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={busy || undefined}
      title={label}
      onClick={() => {
        if (!busy) onChange(!checked);
      }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60',
        checked ? 'bg-brand-600' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

type Flag = 'active' | 'featured';

const COPY: Record<
  Flag,
  { text: string; label: (name: string) => string; done: (name: string, on: boolean) => string }
> = {
  active: {
    text: 'Active',
    label: (name) => `${name}: visible in the shop`,
    done: (name, on) => (on ? `${name} is visible in the shop` : `${name} is hidden from the shop`),
  },
  featured: {
    text: 'Featured',
    label: (name) => `${name}: featured on the home screen`,
    done: (name, on) => (on ? `${name} is featured` : `${name} is no longer featured`),
  },
};

/** Writes the flag immediately; the switch is disabled until the write is acknowledged. */
export function FlagSwitch({
  product,
  flag,
  showLabel = false,
}: {
  product: ProductRecord;
  flag: Flag;
  showLabel?: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const copy = COPY[flag];

  const change = async (value: boolean) => {
    setPending(true);
    try {
      await setProductFlag(product.id, flag, value);
      toast.success(copy.done(product.name, value));
    } catch (error) {
      toast.error(`Couldn't update ${product.name}`, errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const control = (
    <Switch
      checked={product[flag]}
      busy={pending}
      label={copy.label(product.name)}
      onChange={(value) => void change(value)}
    />
  );
  if (!showLabel) return control;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
      {control}
      {copy.text}
    </label>
  );
}
