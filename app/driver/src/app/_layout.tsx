// Registers the native background-location task before anything renders (required by TaskManager).
import '@/features/location/background-task';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Icon, Text } from '@/components/ui';
import { homeHref } from '@/features/auth/home-href';
import { SessionProvider, useSession, type SessionStatus } from '@/features/auth/SessionProvider';
import { ToastProvider } from '@/features/notifications/ToastProvider';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

const ONBOARDING: SessionStatus[] = [
  'needs_profile',
  'needs_phone',
  'pending_approval',
  'suspended',
  'staff_account',
  'shopper_account',
];

function Splash() {
  const { colors } = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: colors.background }]}>
      <View style={[styles.logo, { backgroundColor: colors.primary }]}>
        <Icon name="cube" size={30} color={colors.onPrimary} />
      </View>
      <Text variant="heading">InstaSupply Driver</Text>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function RootNavigator() {
  const { status } = useSession();
  const { colors, dark } = useTheme();
  // Keep the last settled state while a transition (e.g. a token refresh) is loading,
  // so the navigator doesn't unmount and lose its history.
  const settled = useRef<SessionStatus | null>(null);
  if (status !== 'loading') settled.current = status;
  const current = settled.current;

  if (!current) return <Splash />;
  const home = homeHref(current);
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
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
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  logo: { alignItems: 'center', borderRadius: 20, height: 64, justifyContent: 'center', width: 64 },
  splash: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center' },
});
