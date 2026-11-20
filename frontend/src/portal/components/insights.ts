import { CATEGORIES, mulDivHalfUp, type CategoryId, type StoreOrder } from '@instasupply/shared';

/** Store orders that count as sales: handed over to the driver and delivered, or picked up. */
const SOLD = new Set<StoreOrder['status']>(['delivered', 'picked_up']);

export interface RankedRow {
  key: string;
  label: string;
  orders: number;
  units: number;
  /** Store value: price × fulfilled quantity, what the store is paid on. */
  cents: number;
}

export interface StoreInsights {
  orders: number;
  salesCents: number;
  averageCents: number | null;
  /** Σ fulfilled ÷ Σ ordered over the sold orders, 0–1; null without lines. */
  fillRate: number | null;
  /** Median seconds from placement to acceptance; null when no order was accepted. */
  medianAcceptSeconds: number | null;
  topProducts: RankedRow[];
  topCustomers: RankedRow[];
  categories: RankedRow[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[middle - 1] ?? upper) + upper) / 2);
}

function bump(
  map: Map<string, RankedRow>,
  key: string,
  label: string,
  units: number,
  cents: number,
  orderKey: Set<string>,
) {
  const row = map.get(key) ?? { key, label, orders: 0, units: 0, cents: 0 };
  row.units += units;
  row.cents += cents;
  if (!orderKey.has(key)) {
    orderKey.add(key);
    row.orders += 1;
  }
  map.set(key, row);
}

function ranked(map: Map<string, RankedRow>, limit: number): RankedRow[] {
  return [...map.values()].sort((a, b) => b.cents - a.cents || b.units - a.units).slice(0, limit);
}

/**
 * The owner's insights (MARKETPLACE §8), computed in the page over at most 1 000 completed store
 * orders: sales, orders, average order, fill rate (Σ fulfilled ÷ Σ ordered), median time to accept,
 * top products, top customers (company or name) and categories. Sales are the store's own value
 * (`storeValueCents`), never the customer's total with delivery and tax.
 */
export function computeInsights(storeOrders: readonly StoreOrder[], sinceMs: number): StoreInsights {
  const sold = storeOrders.filter(
    (order) => SOLD.has(order.status) && (order.completedAt ?? order.updatedAt) >= sinceMs,
  );
  const products = new Map<string, RankedRow>();
  const customers = new Map<string, RankedRow>();
  const categories = new Map<string, RankedRow>();
  let salesCents = 0;
  let ordered = 0;
  let fulfilled = 0;
  const acceptSeconds: number[] = [];

  for (const order of sold) {
    salesCents += order.storeValueCents;
    const acceptedAt = order.statusAt.accepted;
    if (acceptedAt != null && acceptedAt >= order.createdAt)
      acceptSeconds.push(Math.round((acceptedAt - order.createdAt) / 1000));

    const customer = order.companyName?.trim() || order.customerName.trim() || 'Customer';
    const customerKey = `${order.customerId}:${customer}`;
    bump(customers, customerKey, customer, order.itemCount, order.storeValueCents, new Set());

    const seenProducts = new Set<string>();
    const seenCategories = new Set<string>();
    for (const line of order.lines) {
      ordered += line.quantity;
      fulfilled += line.fulfilledQty;
      const value = line.unitPriceCents * line.fulfilledQty;
      if (line.fulfilledQty > 0) {
        const productKey = line.productId ?? `custom:${line.name}`;
        bump(
          products,
          productKey,
          line.size ? `${line.name}, ${line.size}` : line.name,
          line.fulfilledQty,
          value,
          seenProducts,
        );
        const categoryId = (line.categoryId ?? 'other') as CategoryId | 'other';
        const categoryLabel =
          categoryId === 'other' ? 'Special orders' : (CATEGORIES[categoryId]?.name ?? categoryId);
        bump(categories, categoryId, categoryLabel, line.fulfilledQty, value, seenCategories);
      }
    }
  }

  return {
    orders: sold.length,
    salesCents,
    averageCents: sold.length > 0 ? mulDivHalfUp(salesCents, 1, sold.length) : null,
    fillRate: ordered > 0 ? fulfilled / ordered : null,
    medianAcceptSeconds: median(acceptSeconds),
    topProducts: ranked(products, 10),
    topCustomers: ranked(customers, 10),
    categories: ranked(categories, 50),
  };
}
