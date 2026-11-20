import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, Header, Screen } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { useSession } from './SessionProvider';

/** Opens sign-in (or sign-up) and comes back to `next` afterwards (MARKETPLACE §7.2). */
export function goToSignIn(next: string, screen: 'login' | 'signup' = 'login') {
  router.push({ pathname: screen === 'login' ? '/login' : '/signup', params: { next } });
}

/**
 * Wraps every 🔒 screen of MARKETPLACE §7.3. Guests get "Sign in to order" / "Create account" in the
 * Big Cart empty-state style; a signed-in customer gets `children`, where `useCustomer()` is safe.
 * Pass the screen's own `title` so the header matches what the signed-in screen shows.
 */
export function RequireAccount({
  title,
  message = 'Sign in to order, track deliveries and keep your jobsites, cards and saved items.',
  children,
}: {
  title: string;
  message?: string;
  children: ReactNode;
}) {
  const { status } = useSession();
  const pathname = usePathname();
  if (status === 'ready') return <>{children}</>;
  return (
    <Screen header={<Header title={title} />}>
      <EmptyState art="scene-welcome" title="Sign in to order" message={message} />
      <View style={styles.actions}>
        <Button label="Sign in" onPress={() => goToSignIn(pathname)} />
        <Button label="Create account" variant="secondary" onPress={() => goToSignIn(pathname, 'signup')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md, paddingTop: spacing.lg },
});
