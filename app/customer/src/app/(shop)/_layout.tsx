import { Stack } from 'expo-router';

import { FavoritesProvider } from '@/features/favorites/FavoritesProvider';
import { NotificationsBridge } from '@/features/notifications/NotificationsBridge';
import { useUid } from '@/features/session/SessionProvider';
import { colors } from '@/theme/tokens';

// A deep link or web refresh straight into a shop screen (an order, the cart…) keeps the tabs
// underneath, so "back" and Android's back button lead home instead of leaving the app.
export const unstable_settings = { anchor: '(tabs)' };

/**
 * The shop, for guests and signed-in customers (MARKETPLACE §7.2). 🔒 screens wrap themselves in
 * `<RequireAccount>`. Push, banners and the inbox bridge run only for a signed-in customer.
 */
export default function ShopLayout() {
  const uid = useUid();
  return (
    <FavoritesProvider uid={uid}>
      {uid ? <NotificationsBridge uid={uid} /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="site" options={{ presentation: 'modal' }} />
        <Stack.Screen name="order-success" options={{ gestureEnabled: false }} />
      </Stack>
    </FavoritesProvider>
  );
}
