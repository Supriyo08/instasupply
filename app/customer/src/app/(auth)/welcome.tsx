import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/Wordmark';
import { Button, Text } from '@/components/ui';
import { AuthScaffold } from '@/features/session/components/AuthScaffold';
import { spacing } from '@/theme/tokens';

/** Room above the art for the wordmark. */
const WORDMARK_SPACE = 56;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const openLogin = () => router.push('/login');
  // Guests shop without an account; sign-in comes back when they check out (MARKETPLACE §7.2).
  const browse = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <AuthScaffold
      art="scene-welcome"
      heroRatio={0.52}
      heroTopSpace={WORDMARK_SPACE}
      overlay={
        <View style={[styles.brand, { top: insets.top + spacing.md }]}>
          <Wordmark size={28} />
        </View>
      }
    >
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Welcome
        </Text>
        <Text color="muted">
          Building supplies from local stores near you, delivered to your jobsite or ready for pickup.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button variant="secondary" icon="log-in" label="Login" onPress={openLogin} />
        <Button icon="user-plus" label="Create an account" onPress={() => router.push('/signup')} />
        <Button variant="ghost" icon="search" label="Browse first" onPress={browse} />
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md, marginTop: spacing.xs },
  brand: { alignItems: 'center', left: 0, position: 'absolute', right: 0 },
  heading: { gap: spacing.xs },
});
