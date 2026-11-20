/**
 * The device cart, v2 (MARKETPLACE §7.2, D18): lines carry their store. Prices are never stored here;
 * `useCartPricing` joins live products and stores and prices them with `priceCheckout`, and the server
 * prices again at checkout. Guests and customers share it: signing in keeps it, signing out empties it.
 */
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  MAX_STORES_PER_ORDER,
  type CartLine,
  type Fulfilment,
  type Product,
} from '@instasupply/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'instasupply.cart.v2';
/** The grocery cart; its product ids no longer exist. */
const OLD_STORAGE_KEY = 'instasupply.cart.v1';

export type CartChange =
  { ok: true } | { ok: false; reason: 'too_many_stores' | 'too_many_lines'; message: string };

interface Saved {
  lines: CartLine[];
  promoCode: string | null;
  unloadHelpStoreIds: string[];
  fulfilment: Fulfilment;
}

export interface Cart extends Saved {
  /** False until the saved cart has been read: show a skeleton, not the empty cart. */
  ready: boolean;
  /** Sum of the quantities. */
  count: number;
  /** Distinct stores, in the order their first line was added. */
  storeIds: string[];
  quantityOf: (productId: string) => number;
  /** Adds to the line (creates it). Refuses a 101st line or a 6th store with the reason to show. */
  add: (product: Pick<Product, 'id' | 'storeId'>, quantity?: number) => CartChange;
  /** Sets the quantity, 0 removes the line; clamped to 1–9 999. */
  setQuantity: (product: Pick<Product, 'id' | 'storeId'>, quantity: number) => CartChange;
  remove: (productId: string) => void;
  /** Drops every line of one store ("Remove this store"). */
  removeStore: (storeId: string) => void;
  /** Replaces the whole cart, for Reorder; lines past the limits are dropped. */
  replace: (lines: CartLine[]) => void;
  clear: () => void;
  setPromoCode: (code: string | null) => void;
  setUnloadHelp: (storeId: string, on: boolean) => void;
  setFulfilment: (fulfilment: Fulfilment) => void;
}

const EMPTY: Saved = { lines: [], promoCode: null, unloadHelpStoreIds: [], fulfilment: 'delivery' };
const TOO_MANY_STORES = `One order can include up to ${MAX_STORES_PER_ORDER} stores`;
const TOO_MANY_LINES = `Your cart can hold up to ${MAX_CART_LINES} different items`;

const CartContext = createContext<Cart | null>(null);

function clampQuantity(quantity: number): number {
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.round(quantity)));
}

function storesOf(lines: readonly CartLine[]): string[] {
  return [...new Set(lines.map((line) => line.storeId))];
}

function sanitize(raw: unknown): Saved {
  const saved = (raw ?? {}) as Partial<Saved>;
  const lines: CartLine[] = [];
  for (const line of Array.isArray(saved.lines) ? saved.lines : []) {
    if (!line || typeof line.productId !== 'string' || typeof line.storeId !== 'string') continue;
    const quantity = clampQuantity(Number(line.quantity));
    if (quantity < 1 || lines.length >= MAX_CART_LINES) continue;
    if (!storesOf(lines).includes(line.storeId) && storesOf(lines).length >= MAX_STORES_PER_ORDER) continue;
    lines.push({ productId: line.productId, storeId: line.storeId, quantity });
  }
  const stores = storesOf(lines);
  return {
    lines,
    promoCode: typeof saved.promoCode === 'string' ? saved.promoCode : null,
    unloadHelpStoreIds: (saved.unloadHelpStoreIds ?? []).filter((id) => stores.includes(id)),
    fulfilment: saved.fulfilment === 'pickup' ? 'pickup' : 'delivery',
  };
}

/** Applies a quantity change to `lines`, or says why it can't. */
function withQuantity(
  lines: readonly CartLine[],
  product: Pick<Product, 'id' | 'storeId'>,
  quantity: number,
): { lines: CartLine[]; change: CartChange } {
  const clamped = clampQuantity(quantity);
  const exists = lines.some((line) => line.productId === product.id);
  if (clamped === 0)
    return { lines: lines.filter((line) => line.productId !== product.id), change: { ok: true } };
  if (exists) {
    return {
      lines: lines.map((line) => (line.productId === product.id ? { ...line, quantity: clamped } : line)),
      change: { ok: true },
    };
  }
  if (lines.length >= MAX_CART_LINES) {
    return { lines: [...lines], change: { ok: false, reason: 'too_many_lines', message: TOO_MANY_LINES } };
  }
  const stores = storesOf(lines);
  if (!stores.includes(product.storeId) && stores.length >= MAX_STORES_PER_ORDER) {
    return { lines: [...lines], change: { ok: false, reason: 'too_many_stores', message: TOO_MANY_STORES } };
  }
  return {
    lines: [...lines, { productId: product.id, storeId: product.storeId, quantity: clamped }],
    change: { ok: true },
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.removeItem(OLD_STORAGE_KEY).catch(() => undefined);
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSaved(sanitize(JSON.parse(raw)));
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved)).catch(() => undefined);
  }, [saved, ready]);

  // The change is computed from the current state so the caller gets its outcome synchronously.
  const setQuantity = useCallback(
    (product: Pick<Product, 'id' | 'storeId'>, quantity: number): CartChange => {
      const next = withQuantity(saved.lines, product, quantity);
      if (next.change.ok) {
        setSaved((current) => {
          const lines = withQuantity(current.lines, product, quantity).lines;
          const stores = storesOf(lines);
          return {
            ...current,
            lines,
            unloadHelpStoreIds: current.unloadHelpStoreIds.filter((id) => stores.includes(id)),
          };
        });
      }
      return next.change;
    },
    [saved.lines],
  );

  const value = useMemo<Cart>(() => {
    const quantityOf = (productId: string) =>
      saved.lines.find((line) => line.productId === productId)?.quantity ?? 0;
    return {
      ...saved,
      ready,
      count: saved.lines.reduce((sum, line) => sum + line.quantity, 0),
      storeIds: storesOf(saved.lines),
      quantityOf,
      add: (product, quantity = 1) => setQuantity(product, quantityOf(product.id) + quantity),
      setQuantity,
      remove: (productId) =>
        setSaved((current) => {
          const lines = current.lines.filter((line) => line.productId !== productId);
          const stores = storesOf(lines);
          return {
            ...current,
            lines,
            unloadHelpStoreIds: current.unloadHelpStoreIds.filter((id) => stores.includes(id)),
          };
        }),
      removeStore: (storeId) =>
        setSaved((current) => ({
          ...current,
          lines: current.lines.filter((line) => line.storeId !== storeId),
          unloadHelpStoreIds: current.unloadHelpStoreIds.filter((id) => id !== storeId),
        })),
      replace: (lines) => setSaved((current) => sanitize({ ...current, lines, unloadHelpStoreIds: [] })),
      clear: () => setSaved(EMPTY),
      setPromoCode: (code) =>
        setSaved((current) => ({ ...current, promoCode: code?.trim() ? code.trim().toUpperCase() : null })),
      setUnloadHelp: (storeId, on) =>
        setSaved((current) => {
          const others = current.unloadHelpStoreIds.filter((id) => id !== storeId);
          return { ...current, unloadHelpStoreIds: on ? [...others, storeId] : others };
        }),
      setFulfilment: (fulfilment) => setSaved((current) => ({ ...current, fulfilment })),
    };
  }, [saved, ready, setQuantity]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): Cart {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart must be used inside <CartProvider>.');
  return cart;
}
