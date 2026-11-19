/**
 * Realtime shop data for the dashboard's "Store today" section. Each hook owns one memoised
 * listener and derives its figures client-side, so no extra composite indexes are needed.
 */
import { COLLECTIONS, startOfDay, toMillis, type Order, type Product } from '@instasupply/shared';
import { Timestamp, collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';

import { LOW_STOCK_LIMIT } from '@/features/catalog/catalog-filters';
import { useOpenOrders, type OrderRecord } from '@/lib/data';
import { db } from '@/lib/firebase/app';
import { useCollection } from '@/lib/firebase/hooks';

/** Safety cap on each listener, like the other dashboard queries. */
export const MAX_DOCS = 500;

const RECENT_ORDERS = 5;
const TOP_PRODUCTS = 5;
const LOW_STOCK_SHOWN = 6;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export interface StoreTotals {
  /** Orders placed today, cancelled ones included. */
  orders: number;
  cancelled: number;
  /** Sum of order totals, excluding cancelled orders. */
  revenue: number;
  /** Per non-cancelled order; null until there is one. */
  averageBasket: number | null;
  averageItems: number | null;
}

export interface TopProduct {
  productId: string;
  name: string;
  unit: string;
  units: number;
  revenue: number;
}

export function summarizeOrders(orders: readonly OrderRecord[]): StoreTotals {
  let cancelled = 0;
  let revenue = 0;
  let items = 0;
  for (const order of orders) {
    if (order.status === 'cancelled') {
      cancelled += 1;
    } else {
      revenue += order.total;
      items += order.itemCount;
    }
  }
  const kept = orders.length - cancelled;
  return {
    orders: orders.length,
    cancelled,
    revenue: roundMoney(revenue),
    averageBasket: kept ? roundMoney(revenue / kept) : null,
    averageItems: kept ? items / kept : null,
  };
}

/** Best sellers by units, then revenue. Cancelled orders went back to the shelf, so they don't count. */
export function rankProducts(orders: readonly OrderRecord[], count: number): TopProduct[] {
  const byProduct = new Map<string, TopProduct>();
  // Orders arrive newest first, so a renamed product shows its latest name.
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items) {
      const entry = byProduct.get(item.productId);
      if (entry) {
        entry.units += item.quantity;
        entry.revenue += item.lineTotal;
      } else {
        byProduct.set(item.productId, {
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          units: item.quantity,
          revenue: item.lineTotal,
        });
      }
    }
  }
  return [...byProduct.values()]
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((entry) => ({ ...entry, revenue: roundMoney(entry.revenue) }));
}

/** Shop orders placed since local midnight. `now` picks the day, so the listener moves at midnight. */
export function useTodaySales(now: number) {
  const since = startOfDay(now);
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.orders),
        where('createdAt', '>=', Timestamp.fromMillis(since)),
        orderBy('createdAt', 'desc'),
        limit(MAX_DOCS),
      ),
    [since],
  );
  const orders = useCollection<Order>(q);
  // Right after midnight the previous day's snapshot is still loaded: never count it as today.
  const today = useMemo(
    () => orders.data.filter((order) => (toMillis(order.createdAt) ?? 0) >= since),
    [orders.data, since],
  );
  const derived = useMemo(
    () => ({
      totals: summarizeOrders(today),
      topProducts: rankProducts(today, TOP_PRODUCTS),
      recent: today.slice(0, RECENT_ORDERS),
      capped: today.length >= MAX_DOCS,
    }),
    [today],
  );
  return { ...derived, loading: orders.loading && today.length === 0, error: orders.error };
}

/** The open-order queue. Same query as the sidebar badge, which Firestore shares. */
export function useOrderQueue() {
  const open = useOpenOrders();
  const queue = useMemo(() => {
    const awaiting = open.data.filter((order) => order.status === 'placed');
    return {
      awaiting: awaiting.length,
      // Newest first, so the last one has waited longest.
      oldestAwaiting: awaiting.at(-1)?.createdAt ?? null,
      outForDelivery: open.data.filter((order) => order.status === 'out_for_delivery').length,
    };
  }, [open.data]);
  return { ...queue, loading: open.loading && open.data.length === 0, error: open.error };
}

/**
 * Active products that are low (catalogue limit or fewer units) or out of stock, lowest first. One
 * range listener; `active` is filtered here.
 */
export function useLowStock() {
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.products),
        where('stock', '<=', LOW_STOCK_LIMIT),
        orderBy('stock'),
        limit(MAX_DOCS),
      ),
    [],
  );
  const products = useCollection<Product>(q);
  const low = useMemo(() => {
    const active = products.data
      .filter((product) => product.active)
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
    return { items: active.slice(0, LOW_STOCK_SHOWN), total: active.length };
  }, [products.data]);
  return { ...low, loading: products.loading && products.data.length === 0, error: products.error };
}
