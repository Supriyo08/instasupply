import { describeError } from '@instasupply/expo-firebase';
import type { PlaceOrderRequest } from '@instasupply/shared';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useCart } from '@/features/cart/CartProvider';
import { placeOrder } from '@/features/orders/hooks';

interface PlaceOrderState {
  placing: boolean;
  /** The order went through; the screen is about to be replaced by the success screen. */
  placed: boolean;
  error: string | null;
}

/**
 * Places the order once (double taps are ignored). On success it empties the cart and opens the
 * success screen with the checkout screens removed from the history, so "back" leads home rather
 * than into a finished checkout. Errors come back as user-facing messages (e.g. stock changes).
 */
export function usePlaceOrder() {
  const cart = useCart();
  const [state, setState] = useState<PlaceOrderState>({ placing: false, placed: false, error: null });
  const inFlight = useRef(false);

  const place = useCallback(
    async (request: PlaceOrderRequest) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ placing: true, placed: false, error: null });
      try {
        const result = await placeOrder(request);
        setState({ placing: true, placed: true, error: null });
        cart.clear();
        // Both actions reduce in order: pop to the home tab, then push the receipt on top of it.
        router.dismissTo('/');
        router.push({
          pathname: '/order-success',
          params: { orderId: result.orderId, number: result.number },
        });
      } catch (error) {
        inFlight.current = false;
        setState({
          placing: false,
          placed: false,
          error: describeError(error, "We couldn't place your order. Please try again."),
        });
      }
    },
    [cart],
  );

  return { ...state, place };
}
