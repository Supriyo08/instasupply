import type { LineAdjustment, ShortReason, StoreOrderLine } from '@instasupply/shared';

import { Select, TextInput } from '@/components/ui/Form';

import { SHORT_REASONS } from '../order-format';

export type ShortShipDraft = Record<string, { fulfilledQty: number; reason: ShortReason }>;

/** The adjustments a draft describes: only lines whose quantity went down (§2.1.1, quantities only go down). */
export function adjustmentsOf(lines: readonly StoreOrderLine[], draft: ShortShipDraft): LineAdjustment[] {
  const out: LineAdjustment[] = [];
  for (const line of lines) {
    const entry = draft[line.lineId];
    if (entry && entry.fulfilledQty < line.fulfilledQty) {
      out.push({ lineId: line.lineId, fulfilledQty: entry.fulfilledQty, reason: entry.reason });
    }
  }
  return out;
}

/**
 * Short-ship editor: the store can supply fewer units than ordered. Each line shows ordered and
 * fulfilled quantities; lowering one asks for the reason. The server re-settles the amounts (§3.6).
 */
export function ShortShipEditor({
  lines,
  value,
  onChange,
  disabled,
}: {
  lines: readonly StoreOrderLine[];
  value: ShortShipDraft;
  onChange: (next: ShortShipDraft) => void;
  disabled?: boolean;
}) {
  const set = (line: StoreOrderLine, patch: Partial<{ fulfilledQty: number; reason: ShortReason }>) => {
    const current = value[line.lineId] ?? { fulfilledQty: line.fulfilledQty, reason: 'out_of_stock' };
    onChange({ ...value, [line.lineId]: { ...current, ...patch } });
  };

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Quantities the store can supply</caption>
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Item
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Ordered
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Supplying
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Reason
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((line) => {
            const entry = value[line.lineId];
            const qty = entry?.fulfilledQty ?? line.fulfilledQty;
            const short = qty < line.fulfilledQty;
            return (
              <tr key={line.lineId}>
                <td className="max-w-56 px-3 py-2">
                  <p className="truncate font-medium text-slate-900">{line.name}</p>
                  <p className="text-xs text-slate-500">
                    {[line.sku, line.size].filter(Boolean).join(' · ') || line.unit}
                  </p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                <td className="px-3 py-2">
                  <TextInput
                    type="number"
                    min={0}
                    max={line.fulfilledQty}
                    step={1}
                    value={qty}
                    disabled={disabled}
                    aria-label={`Quantity supplied of ${line.name}`}
                    className="w-20"
                    onChange={(event) => {
                      const next = Math.floor(Number(event.target.value));
                      if (!Number.isFinite(next)) return;
                      set(line, { fulfilledQty: Math.max(0, Math.min(line.fulfilledQty, next)) });
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  {short ? (
                    <Select
                      value={entry?.reason ?? 'out_of_stock'}
                      disabled={disabled}
                      aria-label={`Why ${line.name} is short`}
                      onChange={(event) => set(line, { reason: event.target.value as ShortReason })}
                    >
                      {SHORT_REASONS.map((reason) => (
                        <option key={reason.id} value={reason.id}>
                          {reason.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-xs text-slate-400">In full</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
