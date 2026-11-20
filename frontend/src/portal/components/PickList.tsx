import {
  CATEGORIES,
  type LineAdjustment,
  type ShortReason,
  type StoreOrder,
  type StoreOrderLine,
} from '@instasupply/shared';

import { Select, TextInput } from '@/components/ui/Form';
import { Money } from '@/components/ui/Money';
import { ArtThumb } from '@/features/catalog/components/ArtThumb';
import { cn } from '@/lib/cn';

import { SHORT_REASONS, shortReasonLabel } from './order-format';

/** What the short-ship editor holds per line: the typed quantity and the reason. */
export interface ShortDraft {
  qty: string;
  reason: ShortReason;
}

export type ShortDrafts = Record<string, ShortDraft>;

/** A typed quantity as a whole number from 0 to the line's current fulfilled quantity, or null. */
function parseQty(text: string, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 0 && value <= max ? value : null;
}

/**
 * The adjustments to send with the next action (MARKETPLACE §2.1.1): only lines whose quantity went
 * down. `errors` names lines with a quantity that is not a whole number from 0 to what is left.
 */
export function adjustmentsFrom(
  lines: readonly StoreOrderLine[],
  drafts: ShortDrafts,
): { adjustments: LineAdjustment[]; errors: Record<string, string>; allZero: boolean } {
  const adjustments: LineAdjustment[] = [];
  const errors: Record<string, string> = {};
  for (const line of lines) {
    const draft = drafts[line.lineId];
    if (!draft) continue;
    const qty = parseQty(draft.qty, line.fulfilledQty);
    if (qty === null) {
      errors[line.lineId] = `Enter 0 to ${line.fulfilledQty}.`;
      continue;
    }
    if (qty < line.fulfilledQty)
      adjustments.push({ lineId: line.lineId, fulfilledQty: qty, reason: draft.reason });
  }
  const allZero =
    lines.length > 0 &&
    lines.every((line) => {
      const adjusted = adjustments.find((item) => item.lineId === line.lineId);
      return (adjusted ? adjusted.fulfilledQty : line.fulfilledQty) === 0;
    });
  return { adjustments, errors, allZero };
}

/**
 * The pick list (SKU, item, size, qty, line total) with the short-ship editor: while `editing`, each
 * line gets a "ships" quantity (only ever lower) and a reason. Quantities go to the server with the
 * next Accept, Mark ready or Confirm collection; nothing changes until then.
 */
export function PickList({
  order,
  editing,
  drafts,
  onChange,
  errors,
}: {
  order: StoreOrder;
  editing: boolean;
  drafts: ShortDrafts;
  onChange: (lineId: string, draft: ShortDraft | null) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Items to pick for {order.number}</caption>
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Item
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              SKU
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Size
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Qty
            </th>
            {editing ? (
              <th scope="col" className="px-4 py-2.5 font-medium">
                Ships
              </th>
            ) : null}
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Line total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.lines.map((line) => {
            const draft = drafts[line.lineId];
            const short = line.fulfilledQty < line.quantity;
            const tint = line.categoryId ? CATEGORIES[line.categoryId]?.tint : null;
            const art = line.imageKey ?? (line.categoryId ? CATEGORIES[line.categoryId]?.iconKey : null);
            const error = errors[line.lineId];
            return (
              <tr key={line.lineId} className={cn(draft && 'bg-amber-50/60')}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ArtThumb artKey={art} imageUrl={line.imageUrl} tint={tint} />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{line.name}</p>
                      <p className="text-xs text-slate-500">
                        {[line.brand, `per ${line.unit}`, line.kind === 'custom' ? 'Special order' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {line.note ? <p className="text-xs text-slate-600">Note: {line.note}</p> : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-600">
                  {line.sku ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-700">{line.size ?? '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {short ? (
                    <>
                      <span className="font-semibold text-slate-900">{line.fulfilledQty}</span>
                      <span className="text-slate-500"> of {line.quantity}</span>
                      <span className="block text-xs text-amber-700">
                        Short: {shortReasonLabel(line.shortReason) ?? 'reason not given'}
                      </span>
                    </>
                  ) : (
                    <span className="font-semibold text-slate-900">{line.quantity}</span>
                  )}
                </td>
                {editing ? (
                  <td className="px-4 py-3">
                    <div className="flex min-w-56 items-start gap-2">
                      <div>
                        <TextInput
                          inputMode="numeric"
                          aria-label={`Quantity of ${line.name} you can ship, 0 to ${line.fulfilledQty}`}
                          className="w-20 text-right tabular-nums"
                          value={draft?.qty ?? String(line.fulfilledQty)}
                          invalid={!!error}
                          disabled={line.fulfilledQty === 0}
                          onChange={(event) => {
                            const qty = event.target.value;
                            if (qty.trim() === String(line.fulfilledQty)) onChange(line.lineId, null);
                            else onChange(line.lineId, { qty, reason: draft?.reason ?? 'out_of_stock' });
                          }}
                        />
                        {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
                      </div>
                      {draft ? (
                        <Select
                          aria-label={`Why ${line.name} ships short`}
                          className="w-36"
                          value={draft.reason}
                          onChange={(event) =>
                            onChange(line.lineId, { ...draft, reason: event.target.value as ShortReason })
                          }
                        >
                          {SHORT_REASONS.map((reason) => (
                            <option key={reason.id} value={reason.id}>
                              {reason.label}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </div>
                  </td>
                ) : null}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Money cents={line.lineCents} className={cn(short && 'text-slate-400 line-through')} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
