import { useRef, useState } from 'react';

import { MinusIcon, PlusIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/firebase/callables';

import { stockLevel, type StockLevel } from '../catalog-filters';
import type { ProductRecord } from '../hooks';
import { nudgeProductStock, setProductStock } from '../mutations';
import { STOCK_MAX, toStock } from '../product-form';

const LEVEL: Record<StockLevel, { box: string; text: string; note: string | null }> = {
  ok: { box: 'bg-white ring-slate-300', text: 'text-slate-900', note: null },
  low: { box: 'bg-amber-50 ring-amber-300', text: 'text-amber-800', note: 'Low stock' },
  out: { box: 'bg-rose-50 ring-rose-300', text: 'text-rose-700', note: 'Out of stock' },
};

// Pending/limit states use aria-disabled rather than `disabled`, so a keyboard user's focus stays put.
const STEP =
  'grid h-full w-7 place-items-center text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent';

/**
 * Inline stock control: −/+ change one unit straight away; a typed number is saved on Enter or when
 * leaving the field (Escape restores the current value). Shows live stock while not being edited,
 * and only saves when the number was actually changed, so tabbing through the column never
 * overwrites a sale that happened in the meantime.
 */
export function StockEditor({ product }: { product: ProductRecord }) {
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** The value when editing started (or was last saved): leaving the field unchanged saves nothing. */
  const base = useRef('');
  const level = LEVEL[stockLevel(product)];
  const current = String(product.stock);

  const run = async (write: () => Promise<void>) => {
    setPending(true);
    try {
      await write();
    } catch (error) {
      // Still editing? Show the stock as it was, so leaving the field doesn't retry the failed value.
      base.current = current;
      setDraft((value) => (value === null ? null : current));
      toast.error(`Couldn't update stock for ${product.name}`, errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  /** Saves the typed value if it was changed; returns what the field should show. */
  const commit = (text: string): string => {
    // While a write is pending the field is read-only, so there is nothing new to save.
    if (pending || !text.trim() || text === base.current) return base.current;
    const stock = toStock(Number(text));
    base.current = String(stock);
    if (stock !== product.stock) void run(() => setProductStock(product.id, stock));
    return base.current;
  };

  const nudge = (delta: 1 | -1) => {
    if (pending) return;
    if (delta < 0 ? product.stock <= 0 : product.stock >= STOCK_MAX) return;
    void run(() => nudgeProductStock(product.id, delta));
  };

  const canRemove = !pending && product.stock > 0;
  const canAdd = !pending && product.stock < STOCK_MAX;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div
        role="group"
        aria-label={`Stock for ${product.name}`}
        aria-busy={pending || undefined}
        className={cn('inline-flex h-8 items-stretch rounded-lg shadow-sm ring-1 ring-inset', level.box)}
      >
        <button
          type="button"
          className={cn(STEP, 'rounded-l-lg')}
          aria-label={`Remove one ${product.name}`}
          title="Remove one"
          aria-disabled={!canRemove || undefined}
          onClick={() => nudge(-1)}
        >
          <MinusIcon size={14} aria-hidden />
        </button>
        <input
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          aria-label={`Units of ${product.name} in stock`}
          maxLength={String(STOCK_MAX).length}
          readOnly={pending}
          value={draft ?? current}
          onFocus={(event) => {
            base.current = current;
            setDraft(current);
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
          onBlur={(event) => {
            commit(event.currentTarget.value);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setDraft(commit(event.currentTarget.value));
              event.currentTarget.select();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              base.current = current;
              setDraft(current);
              event.currentTarget.select();
            }
          }}
          className={cn(
            'w-12 border-x border-slate-900/10 bg-transparent px-1 text-center text-sm font-medium tabular-nums focus:ring-2 focus:ring-brand-500 focus:outline-none focus:ring-inset',
            level.text,
            pending && 'opacity-60',
          )}
        />
        <button
          type="button"
          className={cn(STEP, 'rounded-r-lg')}
          aria-label={`Add one ${product.name}`}
          title="Add one"
          aria-disabled={!canAdd || undefined}
          onClick={() => nudge(1)}
        >
          <PlusIcon size={14} aria-hidden />
        </button>
      </div>
      {level.note ? <span className={cn('text-[11px] font-medium', level.text)}>{level.note}</span> : null}
    </div>
  );
}
