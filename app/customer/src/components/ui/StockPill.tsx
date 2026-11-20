import { LOW_STOCK_THRESHOLD } from '@instasupply/shared';

import { StatusPill } from './StatusPill';

/**
 * "1,200 in stock at Kestrel" / "Only 4 left" / "Out of stock" from `availableQty(product)`
 * (MARKETPLACE §7.3 product row). `storeName` adds "at …" to the in-stock label.
 */
export function StockPill({
  available,
  storeName,
  size = 'sm',
}: {
  available: number;
  storeName?: string | null;
  size?: 'sm' | 'md';
}) {
  if (available <= 0) return <StatusPill label="Out of stock" tone="danger" size={size} />;
  if (available <= LOW_STOCK_THRESHOLD)
    return <StatusPill label={`Only ${available} left`} tone="warning" size={size} />;
  const count = available.toLocaleString('en-CA');
  return (
    <StatusPill
      label={storeName ? `${count} in stock at ${storeName}` : `${count} in stock`}
      tone="success"
      size={size}
    />
  );
}
