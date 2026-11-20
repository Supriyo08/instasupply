import type { QueryKey } from '@instasupply/api-client';
import { useApi, useApiMutation, type OptimisticCache } from '@instasupply/api-client/react';
import { formatMoney, type Product } from '@instasupply/shared';
import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TextInput } from '@/components/ui/Form';
import { CheckIcon, CloseIcon, EditIcon, MinusIcon, PlusIcon } from '@/components/ui/icons';
import { Money } from '@/components/ui/Money';
import { Popover } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { describeError, isNetworkError } from '@/lib/api';
import { cn } from '@/lib/cn';

import { centsToInput, parseDollars } from '../catalog-model';

/** Patches one product in a complete list the page holds (the portal catalogue), when there is one. */
function patchRow(listKey: QueryKey | null, productId: string, apply: (product: Product) => Product) {
  return (cache: OptimisticCache) => {
    if (!listKey) return;
    cache.patch<Product[]>(listKey, (list) =>
      list.map((item) => (item.id === productId ? apply(item) : item)),
    );
  };
}

/**
 * On hand with ± nudges and "Set count" (MARKETPLACE §8). Safe because `reserved` is separate: the
 * server applies a delta atomically. Nudges are optimistic (CLIENTS §1.12). A count below `reserved`
 * asks first, since those units are promised to open orders. The stock-adjust call is not retry-safe:
 * after a lost answer the list is reloaded and the user is asked to check before adjusting again.
 */
export function StockCell({ product, listKey }: { product: Product; listKey: QueryKey | null }) {
  const client = useApi();
  const toast = useToast();
  const [pending, setPending] = useState<{ delta: number; next: number } | null>(null);
  const [count, setCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);

  const adjust = useApiMutation((api, delta: number) => api.products.adjustStock(product.id, delta), {
    optimistic: (cache, delta) =>
      patchRow(listKey, product.id, (item) => ({
        ...item,
        stockOnHand: Math.max(0, item.stockOnHand + delta),
      }))(cache),
  });

  const send = async (delta: number) => {
    if (delta === 0) return;
    try {
      await adjust.run(delta);
    } catch (caught) {
      if (isNetworkError(caught)) {
        void client.cache.invalidate(['products']);
        toast.error(
          `Couldn't confirm the count for ${product.name}`,
          'The change may or may not have been saved. Check the count once it reloads before adjusting again.',
        );
      } else {
        toast.error(`Couldn't change the count for ${product.name}`, describeError(caught));
      }
    }
  };

  const request = (delta: number) => {
    const next = product.stockOnHand + delta;
    if (next < 0) return;
    if (delta < 0 && next < product.reserved) setPending({ delta, next });
    else void send(delta);
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton
        icon={MinusIcon}
        size="sm"
        label={`One less ${product.name} on hand`}
        disabled={adjust.busy || product.stockOnHand === 0}
        onClick={() => request(-1)}
      />
      <span
        className={cn(
          'w-12 text-center font-semibold text-slate-900 tabular-nums',
          adjust.busy && 'opacity-60',
        )}
      >
        {product.stockOnHand.toLocaleString('en-CA')}
      </span>
      <IconButton
        icon={PlusIcon}
        size="sm"
        label={`One more ${product.name} on hand`}
        disabled={adjust.busy}
        onClick={() => request(1)}
      />
      <Popover
        align="right"
        className="w-64 p-3"
        trigger={({ toggle, open }) => (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-label={`Set the count of ${product.name}`}
            onClick={() => {
              setCount(String(product.stockOnHand));
              setCountError(null);
              toggle();
            }}
          >
            Set
          </Button>
        )}
      >
        {(close) => (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = count.trim();
              if (!/^\d+$/.test(value) || Number(value) > 1_000_000) {
                setCountError('Enter a whole number from 0 to 1,000,000.');
                return;
              }
              const next = Number(value);
              const delta = next - product.stockOnHand;
              close();
              if (delta === 0) return;
              if (next < product.reserved) setPending({ delta, next });
              else void send(delta);
            }}
          >
            <label className="block text-xs font-medium text-slate-600" htmlFor={`count-${product.id}`}>
              Counted on the shelf
            </label>
            <TextInput
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              id={`count-${product.id}`}
              inputMode="numeric"
              value={count}
              invalid={!!countError}
              onChange={(event) => setCount(event.target.value)}
            />
            {countError ? <p className="text-xs font-medium text-rose-600">{countError}</p> : null}
            <p className="text-xs text-slate-500">{product.reserved} held by open orders stay reserved.</p>
            <Button type="submit" size="sm" className="w-full">
              Save count
            </Button>
          </form>
        )}
      </Popover>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Set ${product.name} to ${pending?.next ?? 0}?`}
        description={`${product.reserved} units are promised to open orders. With fewer on hand, some of those orders may ship short.`}
        confirmLabel="Set the count anyway"
        tone="danger"
        onConfirm={async () => {
          if (!pending) return;
          await adjust.run(pending.delta);
        }}
      />
    </div>
  );
}

/** The price with an inline editor (Enter saves, Escape cancels). Not optimistic: it changes what customers pay. */
export function PriceCell({ product }: { product: Product }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const save = useApiMutation((api, priceCents: number) => api.products.update(product.id, { priceCents }));

  const submit = async () => {
    const cents = parseDollars(value);
    if (cents === null || cents < 1) {
      setError('Enter a price such as 12.99.');
      return;
    }
    if (product.compareAtCents != null && cents >= product.compareAtCents) {
      setError(
        `Keep it below the “was” price of ${formatMoney(product.compareAtCents)}, or change that in Edit.`,
      );
      return;
    }
    if (cents === product.priceCents) {
      setEditing(false);
      return;
    }
    try {
      await save.run(cents);
      setEditing(false);
      toast.success(`${product.name} is now ${formatMoney(cents)}`);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Money cents={product.priceCents} className="font-medium text-slate-900" />
        {product.compareAtCents != null ? (
          <Money cents={product.compareAtCents} className="text-xs text-slate-400 line-through" />
        ) : null}
        <IconButton
          icon={EditIcon}
          size="sm"
          label={`Change the price of ${product.name}`}
          onClick={() => {
            setValue(centsToInput(product.priceCents));
            setError(null);
            setEditing(true);
          }}
        />
      </div>
    );
  }
  return (
    <form
      className="flex flex-col items-end gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-1">
        <TextInput
          autoFocus
          inputMode="decimal"
          aria-label={`New price of ${product.name}, in dollars`}
          className="w-24 text-right tabular-nums"
          value={value}
          invalid={!!error}
          disabled={save.busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
          }}
        />
        <IconButton icon={CheckIcon} size="sm" type="submit" label="Save price" disabled={save.busy} />
        <IconButton
          icon={CloseIcon}
          size="sm"
          label="Cancel"
          disabled={save.busy}
          onClick={() => setEditing(false)}
        />
      </div>
      {error ? <p className="max-w-48 text-right text-xs font-medium text-rose-600">{error}</p> : null}
    </form>
  );
}

/** "For sale" switch, optimistic (CLIENTS §1.12). */
export function ActiveSwitch({ product, listKey }: { product: Product; listKey: QueryKey | null }) {
  const toast = useToast();
  const toggle = useApiMutation((api, active: boolean) => api.products.update(product.id, { active }), {
    optimistic: (cache, active) => patchRow(listKey, product.id, (item) => ({ ...item, active }))(cache),
    onError: (error) => toast.error(`Couldn't change ${product.name}`, describeError(error)),
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={product.active}
      aria-label={`${product.name} for sale`}
      disabled={toggle.busy}
      onClick={() => void toggle.run(!product.active).catch(() => undefined)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60',
        product.active ? 'bg-brand-600' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform',
          product.active && 'translate-x-4',
        )}
      />
    </button>
  );
}
