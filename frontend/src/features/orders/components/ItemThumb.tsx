/**
 * Product thumbnail for order lines. The only orders module that imports @instasupply/art: keep it
 * out of anything the dashboard, the orders list or the delivery screens load (it is large).
 */
import { artDataUri } from '@instasupply/art';
import type { OrderItem } from '@instasupply/shared';
import { useMemo, useState } from 'react';

import { NoImageIcon } from '@/components/ui/icons';

export function ItemThumb({ item }: { item: Pick<OrderItem, 'imageKey' | 'imageUrl'> }) {
  // An uploaded photo wins; the illustration covers products without one. Unknown keys (the art
  // set changes over time) and broken photos fall through to the next option.
  const sources = useMemo(
    () => [item.imageUrl, artDataUri(item.imageKey)].filter((src): src is string => !!src),
    [item.imageKey, item.imageUrl],
  );
  const [failures, setFailures] = useState(0);
  const src = sources[failures];

  return (
    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200/70">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className={src.startsWith('data:') ? 'size-full object-contain p-1' : 'size-full object-cover'}
          onError={() => setFailures((count) => count + 1)}
        />
      ) : (
        <NoImageIcon size={18} className="text-slate-300" aria-hidden />
      )}
    </span>
  );
}
