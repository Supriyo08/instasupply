import { isArtKey } from '@instasupply/art';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtImage, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { IconBadge } from './StepHeading';

// A scene no auth screen uses: on web, two mounted copies of one inline SVG share gradient ids.
const ART = 'scene-pickup-ready';

/** Shown while sign-up finishes creating the shopping profile. */
export function AccountSetupPending() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityLiveRegion="polite"
    >
      {isArtKey(ART) ? (
        <ArtImage artKey={ART} width={240} height={200} />
      ) : (
        <IconBadge icon="shopping-bag" size={150} />
      )}
      <View style={styles.copy}>
        <Text variant="title" align="center" accessibilityRole="header">
          Setting up your account
        </Text>
        <Text color="muted" align="center">
          Getting your account ready. This only takes a moment.
        </Text>
      </View>
      <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { gap: spacing.sm, maxWidth: 300 },
  root: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.xl,
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
  },
});
