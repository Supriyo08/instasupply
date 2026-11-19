import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

import { webColumn } from './layout';

export interface ScreenProps {
  children: ReactNode;
  /** Rendered above the scroll area (usually <Header />). */
  header?: ReactNode;
  /** Pinned to the bottom (e.g. the primary action). */
  footer?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  background?: string;
  /** Pad the top for the status bar when there is no header. */
  safeTop?: boolean;
}

export function Screen({
  children,
  header,
  footer,
  scroll = true,
  refreshing = false,
  onRefresh,
  contentStyle,
  background = colors.background,
  safeTop = false,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: safeTop && !header ? insets.top + 8 : spacing.lg };
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, padding, webColumn, contentStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padding, webColumn, contentStyle]}>{children}</View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: background }]}>
      {header}
      {/* `padding` on both platforms: Expo apps are edge-to-edge on Android, so the window no
          longer resizes for the keyboard there. (The web ignores `behavior`.) */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        {body}
        {footer ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            {/* The gutter sits inside the column, so the footer lines up with the body on the web. */}
            <View style={[styles.footerColumn, webColumn]}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: 40, paddingHorizontal: spacing.gutter },
  fill: { flex: 1 },
  footer: { backgroundColor: colors.surface, paddingTop: 14 },
  footerColumn: { gap: 10, paddingHorizontal: spacing.gutter },
});
