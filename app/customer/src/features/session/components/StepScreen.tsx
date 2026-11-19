import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Screen with the white Big Cart header and a centred form column. Like `Screen`, but it sets a
 * keyboard `behavior` on Android too: Expo apps are edge-to-edge there, so the window no longer
 * resizes for the keyboard.
 */
export function StepScreen({
  title,
  back = true,
  onBack,
  footer,
  children,
}: {
  title: string;
  back?: boolean;
  onBack?: () => void;
  /** Pinned to the bottom (e.g. the primary action). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Header title={title} back={back} onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: (footer ? 0 : insets.bottom) + spacing.xxxl },
          ]}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.column}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignSelf: 'center', gap: spacing.lg, maxWidth: 480, width: '100%' },
  content: { flexGrow: 1, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  fill: { flex: 1 },
  footer: { backgroundColor: colors.surface, paddingHorizontal: spacing.gutter, paddingTop: 14 },
  root: { backgroundColor: colors.background, flex: 1 },
});
