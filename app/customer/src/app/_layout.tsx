// Per-weight imports: the package index requires all 18 Poppins files, which would all be bundled.
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { ApiProvider } from '@instasupply/api-client/react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Splash } from '@/components/brand/Splash';
import { ErrorState, Header, Screen } from '@/components/ui';
import { CartProvider } from '@/features/cart/CartProvider';
import { ToastProvider } from '@/features/notifications/ToastProvider';
import { AccountSetupPending } from '@/features/session/components/AccountSetupPending';
import { SignOutLink } from '@/features/session/components/SignOutLink';
import { SessionEndNotice } from '@/features/session/SessionEndNotice';
import {
  homeHref,
  SessionProvider,
  useSession,
  type SessionStatus,
} from '@/features/session/SessionProvider';
import { SiteProvider } from '@/features/site/SiteProvider';
import { api } from '@/lib/api';
import { colors } from '@/theme/tokens';

const SETUP: SessionStatus[] = ['needs_profile', 'needs_phone', 'wrong_account'];

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status, signingUp, problem, retry, user } = useSession();
  // Keep the last settled state while something reloads, so the navigator keeps its history.
  const settled = useRef<SessionStatus | null>(null);
  if (status !== 'loading') settled.current = status;
  const current = settled.current;

  // While loading, a cover hides the screen underneath: don't leave its keyboard up over the cover.
  const covered = status === 'loading';
  useEffect(() => {
    if (covered) Keyboard.dismiss();
  }, [covered]);

  if (!fontsReady) return <Splash />;
  // The session can't finish loading by itself: explain, with a way to retry or switch account.
  if (problem && status === 'loading') {
    return (
      <>
        <StatusBar style="dark" />
        <Screen header={<Header title="InstaSupply" back={false} />}>
          <ErrorState icon="wifi-off" title="We couldn't open the app" message={problem} onRetry={retry} />
          {user ? <SignOutLink email={user.email} /> : null}
        </Screen>
      </>
    );
  }
  if (!current) return <Splash />;
  const home = homeHref(current);
  return (
    <>
      <StatusBar style="dark" />
      <SessionEndNotice />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={current === 'onboarding'} redirectTo={home}>
          <Stack.Screen name="(intro)" />
        </Stack.Protected>
        <Stack.Protected guard={current === 'guest' || current === 'ready'} redirectTo={home}>
          <Stack.Screen name="(shop)" />
        </Stack.Protected>
        {/* Guests push sign-in over the shop (`/login?next=…`); signing in removes it again. */}
        <Stack.Protected guard={current === 'guest'} redirectTo={home}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={SETUP.includes(current)} redirectTo={home}>
          <Stack.Screen name="(setup)" />
        </Stack.Protected>
      </Stack>
      {covered ? (
        // Sign-up keeps its own message up while the new account's profile is being created.
        <View style={StyleSheet.absoluteFill}>{signingUp ? <AccountSetupPending /> : <Splash />}</View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  useEffect(() => {
    if (fontError) console.warn('Could not load the app fonts; using system fonts instead.', fontError);
  }, [fontError]);

  return (
    <SafeAreaProvider>
      <ApiProvider client={api}>
        <SessionProvider>
          <SiteProvider>
            <CartProvider>
              <ToastProvider>
                {/* A font that fails to load must not hold the app on the splash. */}
                <RootNavigator fontsReady={fontsLoaded || fontError != null} />
              </ToastProvider>
            </CartProvider>
          </SiteProvider>
        </SessionProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
