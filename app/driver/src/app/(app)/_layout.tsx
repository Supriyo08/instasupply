import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { useDriver } from '@/features/auth/SessionProvider';
import { useActiveDeliveries } from '@/features/deliveries/hooks';
import { PresenceProvider } from '@/features/location/PresenceProvider';
import type { TrackingMode } from '@/features/location/publisher';
import { NotificationsBridge } from '@/features/notifications/NotificationsBridge';
import { useTheme } from '@/theme/ThemeProvider';

/** From `accepted` onwards stores and sites see the driver approach (MARKETPLACE §10, CLIENTS §4.6). */
const LIVE_STATUSES = new Set(['accepted', 'picked_up', 'in_transit', 'arrived']);

/** Signed-in, approved driver area: live location, notifications and the main navigation. */
export default function AppLayout() {
  const { user } = useDriver();
  const { colors } = useTheme();
  const active = useActiveDeliveries(user.uid);
  const mode: TrackingMode = active.data.some((delivery) => LIVE_STATUSES.has(delivery.status))
    ? 'live'
    : 'normal';

  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.background },
  };

  return (
    <PresenceProvider uid={user.uid} mode={mode}>
      <NotificationsBridge uid={user.uid} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="job/[id]" options={{ ...header, title: 'Job' }} />
        <Stack.Screen name="delivery/[id]/index" options={{ ...header, title: 'Delivery' }} />
        <Stack.Screen
          name="delivery/[id]/complete"
          options={{ ...header, title: 'Drop-off', presentation: 'modal' }}
        />
        <Stack.Screen
          name="delivery/[id]/fail"
          options={{ ...header, title: 'Report a problem', presentation: 'modal' }}
        />
        <Stack.Screen name="profile" options={{ ...header, title: 'Profile' }} />
        <Stack.Screen name="vehicle" options={{ ...header, title: 'Vehicle' }} />
        <Stack.Screen name="notifications" options={{ ...header, title: 'Notifications' }} />
        <Stack.Screen name="history" options={{ ...header, title: 'History' }} />
      </Stack>
    </PresenceProvider>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
