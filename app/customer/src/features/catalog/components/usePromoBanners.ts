import { findPromo, formatCurrency, FREE_DELIVERY_THRESHOLD } from '@instasupply/shared';
import { router } from 'expo-router';

import { useCart } from '@/features/cart/CartProvider';
import { useToast } from '@/features/notifications/ToastProvider';
import { useIsFirstOrder } from '@/features/orders/hooks';
import { colors, gradient } from '@/theme/tokens';

export interface PromoBanner {
  key: string;
  /** Scene illustration key in @instasupply/art. */
  art: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  /** brand = green gradient with white text; light = pastel tint with dark text. */
  tone: 'brand' | 'light';
  colors: readonly [string, string];
  onPress: () => void;
}

const WELCOME = findPromo('FIRST20');
const EVERYDAY = findPromo('FRESH10');

/** The home carousel: welcome code, free delivery and fresh fruit. */
export function usePromoBanners(uid: string): PromoBanner[] {
  const { setPromoCode } = useCart();
  const toast = useToast();
  const firstOrder = useIsFirstOrder(uid);

  const applyWelcomeCode = () => {
    if (!WELCOME) return;
    if (!firstOrder) {
      toast({
        title: `${WELCOME.code} is for first orders`,
        body: EVERYDAY ? `Use ${EVERYDAY.code} instead: ${EVERYDAY.label}.` : undefined,
        icon: 'tag',
      });
      return;
    }
    setPromoCode(WELCOME.code);
    toast({
      title: `${WELCOME.code} added to your cart`,
      body: `${WELCOME.label}. The discount shows at checkout.`,
      icon: 'tag',
      onPress: () => router.push('/cart'),
    });
  };

  return [
    {
      key: 'welcome',
      art: 'scene-pickup-ready',
      eyebrow: 'Welcome offer',
      title: `${WELCOME?.percent ?? 20}% off on your first purchase`,
      subtitle: `Use code ${WELCOME?.code ?? 'FIRST20'} at checkout`,
      cta: 'Apply code',
      tone: 'brand',
      colors: gradient.colors,
      onPress: applyWelcomeCode,
    },
    {
      key: 'delivery',
      art: 'scene-jobsite-delivery',
      eyebrow: 'Free delivery',
      title: `Free delivery on orders above ${formatCurrency(FREE_DELIVERY_THRESHOLD)}`,
      subtitle: 'Fresh groceries to your doorstep',
      cta: 'Shop now',
      tone: 'light',
      colors: [colors.infoSoft, colors.surface],
      onPress: () => router.push('/categories'),
    },
    {
      key: 'fruits',
      art: 'scene-material-list',
      eyebrow: 'Farm fresh',
      title: 'Fresh fruits, picked daily',
      subtitle: 'Seasonal picks from local farms',
      cta: 'Shop fruits',
      tone: 'light',
      colors: [colors.dangerSoft, colors.warningSoft],
      onPress: () => router.push('/category/fruits'),
    },
  ];
}
