import { Stack } from 'expo-router';

import { useDriver } from '@/features/auth/SessionProvider';
import { useActiveDeliveries } from '@/features/deliveries/hooks';
import { PresenceProvider } from '@/features/location/PresenceProvider';
import { NotificationsBridge } from '@/features/notifications/NotificationsBridge';
import { useTheme } from '@/theme/ThemeProvider';

/** Signed-in, approved driver area: live location, notifications and the main navigation. */
export default function AppLayout() {
  const { user } = useDriver();
  const { colors } = useTheme();
  const active = useActiveDeliveries(user.uid);
  // Stream location more often while the driver is heading to a customer.
  const live = active.data.some(
    (delivery) => delivery.status === 'in_transit' || delivery.status === 'arrived',
  );

  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.background },
  };

  return (
    <PresenceProvider uid={user.uid} mode={live ? 'live' : 'normal'}>
      <NotificationsBridge uid={user.uid} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="delivery/[id]/index" options={{ ...header, title: 'Delivery' }} />
        <Stack.Screen
          name="delivery/[id]/complete"
          options={{ ...header, title: 'Proof of delivery', presentation: 'modal' }}
        />
        <Stack.Screen
          name="delivery/[id]/fail"
          options={{ ...header, title: 'Report a problem', presentation: 'modal' }}
        />
        <Stack.Screen name="notifications" options={{ ...header, title: 'Notifications' }} />
        <Stack.Screen name="history" options={{ ...header, title: 'History' }} />
      </Stack>
    </PresenceProvider>
  );
}
