import { router } from 'expo-router';

/** Back to the home tab, dropping the cart and checkout screens from the history. */
export function goShopping() {
  router.dismissTo('/');
}

/** Back to the cart (or open it) to fix quantities or the promo code. */
export function reviewCart() {
  router.dismissTo('/cart');
}

/** First value of a route param (`?id=a&id=b` arrives as an array), or undefined when blank. */
export function singleParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first : undefined;
}
