/**
 * Shopping cart: product ids + quantities, persisted on the device. Prices are never stored here;
 * they are joined live from the catalogue (useCartDetails) and re-checked by the server at checkout.
 */
import { MAX_CART_LINES, MAX_QUANTITY_PER_LINE, type CartLine } from '@instasupply/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'instasupply.cart.v1';

interface Cart {
  lines: CartLine[];
  count: number;
  promoCode: string | null;
  quantityOf: (productId: string) => number;
  add: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  setPromoCode: (code: string | null) => void;
}

const CartContext = createContext<Cart | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { lines?: CartLine[]; promoCode?: string | null };
        setLines((saved.lines ?? []).filter((line) => line.productId && line.quantity > 0));
        setPromoCode(saved.promoCode ?? null);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ lines, promoCode })).catch(() => undefined);
  }, [lines, promoCode, loaded]);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) => {
      const clamped = Math.max(0, Math.min(MAX_QUANTITY_PER_LINE, Math.round(quantity)));
      const exists = current.some((line) => line.productId === productId);
      if (clamped === 0) return current.filter((line) => line.productId !== productId);
      if (exists)
        return current.map((line) => (line.productId === productId ? { ...line, quantity: clamped } : line));
      if (current.length >= MAX_CART_LINES) return current;
      return [...current, { productId, quantity: clamped }];
    });
  }, []);

  const value = useMemo<Cart>(() => {
    const quantityOf = (productId: string) =>
      lines.find((line) => line.productId === productId)?.quantity ?? 0;
    return {
      lines,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      promoCode,
      quantityOf,
      add: (productId, quantity = 1) => setQuantity(productId, quantityOf(productId) + quantity),
      setQuantity,
      remove: (productId) => setQuantity(productId, 0),
      clear: () => {
        setLines([]);
        setPromoCode(null);
      },
      setPromoCode: (code) => setPromoCode(code ? code.trim().toUpperCase() : null),
    };
  }, [lines, promoCode, setQuantity]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): Cart {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart must be used inside <CartProvider>.');
  return cart;
}
