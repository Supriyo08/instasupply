import { Stack } from 'expo-router';

import { FavoritesProvider } from '@/features/favorites/FavoritesProvider';
import { NotificationsBridge } from '@/features/notifications/NotificationsBridge';
import { useCustomer } from '@/features/session/SessionProvider';
import { colors } from '@/theme/tokens';

// A deep link or web refresh straight into a shop screen (an order, the cart…) keeps the tabs
// underneath, so "back" and Android's back button lead home instead of leaving the app.
export const unstable_settings = { anchor: '(tabs)' };

/** Signed-in shopping area. Screens draw their own <Header /> (Big Cart style). */
export default function ShopLayout() {
  const { user } = useCustomer();
  return (
    <FavoritesProvider uid={user.uid}>
      <NotificationsBridge uid={user.uid} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="checkout/address" />
        <Stack.Screen name="checkout/payment" />
        <Stack.Screen name="order-success" options={{ gestureEnabled: false }} />
      </Stack>
    </FavoritesProvider>
  );
}
