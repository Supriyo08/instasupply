import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui';
import { colors, radius, shadows, spacing } from '@/theme/tokens';

import { HeroPanel } from './HeroPanel';

const SHEET_OVERLAP = 26;
const MIN_HERO = 190;
const MAX_HERO = 480;

/**
 * Welcome / login / sign-up layout: illustrated hero on top and a rounded sheet holding the form.
 * Scrolls with the keyboard on every platform (Android is edge-to-edge, so `behavior` is needed there too).
 */
export function AuthScaffold({
  art,
  heroRatio,
  heroTopSpace = 12,
  onBack,
  overlay,
  children,
}: {
  art: string;
  /** Hero height as a share of the window height. */
  heroRatio: number;
  /** Room above the art for an overlay such as the wordmark. */
  heroTopSpace?: number;
  onBack?: () => void;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const heroHeight = Math.round(
    Math.min(Math.max(height * heroRatio, MIN_HERO + insets.top), MAX_HERO + insets.top),
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <ScrollView
        bounces={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <HeroPanel
          artKey={art}
          width={width}
          height={heroHeight}
          topInset={insets.top + heroTopSpace}
          bottomInset={SHEET_OVERLAP}
        >
          {onBack ? (
            <View style={[styles.back, { top: insets.top + 8 }]}>
              <IconButton icon="arrow-left" label="Back" background={colors.surface} onPress={onBack} />
            </View>
          ) : null}
          {overlay}
        </HeroPanel>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xxl }]}>
          <View style={styles.column}>{children}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  back: { borderRadius: radius.pill, left: spacing.gutter, position: 'absolute', ...shadows.soft },
  column: { alignSelf: 'center', gap: spacing.lg, maxWidth: 480, width: '100%' },
  root: { backgroundColor: colors.background, flex: 1 },
  scroll: { flexGrow: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    flexGrow: 1,
    marginTop: -SHEET_OVERLAP,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xxl + spacing.xs,
  },
});
