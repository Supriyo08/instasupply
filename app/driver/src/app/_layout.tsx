import { ApiProvider } from '@instasupply/api-client/react';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { Button, Icon, Text } from '@/components/ui';
import { signOut } from '@/features/auth/auth-service';
import { homeHref } from '@/features/auth/home-href';
import {
  DRIVER_STATUSES,
  SessionProvider,
  useSession,
  type SessionStatus,
} from '@/features/auth/SessionProvider';
import { PushRegistrar } from '@/features/notifications/PushRegistrar';
import { ToastProvider } from '@/features/notifications/ToastProvider';
import { api } from '@/lib/api';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

// The background location task is defined by the entry file (index.ts), before the router loads.

const ONBOARDING: SessionStatus[] = [
  'needs_profile',
  'needs_phone',
  'pending_approval',
  'suspended',
  'staff_account',
  'shopper_account',
  'supplier_account',
];

function Splash() {
  const { colors } = useTheme();
  const { problem, retry, user } = useSession();
  return (
    <View style={[styles.splash, { backgroundColor: colors.background }]}>
      <View style={[styles.logo, { backgroundColor: colors.primary }]}>
        <Icon name="cube" size={30} color={colors.onPrimary} />
      </View>
      <Text variant="heading">InstaSupply Driver</Text>
      {problem ? (
        <View style={styles.problem}>
          <Text color="muted" align="center">
            {problem}
          </Text>
          <Button label="Try again" icon="refresh" fullWidth={false} onPress={retry} />
          {user ? (
            <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={8}>
              <Text variant="caption" color="primary">
                Sign out
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}

function RootNavigator() {
  const { status, user } = useSession();
  const { colors, dark } = useTheme();
  // Keep the last settled state while a transition is loading, so the navigator does not unmount
  // and lose its history.
  const settled = useRef<SessionStatus | null>(null);
  if (status !== 'loading') settled.current = status;
  const current = settled.current;

  if (!current) return <Splash />;
  const home = homeHref(current);
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {user && DRIVER_STATUSES.includes(current) ? <PushRegistrar uid={user.uid} /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={current === 'signed_out'} redirectTo={home}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={ONBOARDING.includes(current)} redirectTo={home}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={current === 'ready'} redirectTo={home}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
      {status === 'loading' ? (
        <View style={StyleSheet.absoluteFill}>
          <Splash />
        </View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <ApiProvider client={api}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ApiProvider>
  );
}

/** A render error anywhere below shows a recoverable screen instead of a blank app (code review R56). */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RouteErrorBoundary {...props} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  logo: { alignItems: 'center', borderRadius: 20, height: 64, justifyContent: 'center', width: 64 },
  problem: { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  splash: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center' },
});
