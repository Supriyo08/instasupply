import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<NoticeTone, { background: string; accent: string; icon: IconName }> = {
  info: { background: colors.infoSoft, accent: colors.info, icon: 'info' },
  success: { background: colors.primarySoft, accent: colors.primaryDark, icon: 'check-circle' },
  warning: { background: colors.warningSoft, accent: colors.warning, icon: 'alert-triangle' },
  danger: { background: colors.dangerSoft, accent: colors.danger, icon: 'alert-circle' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  /** Replaces the tone's own icon, e.g. `shield` on a test-mode note. */
  icon?: IconName;
  title?: string;
  message: string;
  /** One or two words for the link at the right edge ("Remove", "Try again"); needs `onAction`. */
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Soft inline banner: form errors, confirmations, stock warnings, hints. The tone sets the colour
 * and the icon; an optional action sits at the right edge. A whole section or screen that failed
 * to load gets an `ErrorState` instead.
 */
export function Notice({ tone = 'info', icon, title, message, actionLabel, onAction, style }: NoticeProps) {
  const palette = TONES[tone];
  const action = actionLabel && onAction ? { label: actionLabel, onPress: onAction } : null;
  return (
    <View
      // Read as one element, unless it holds a button that has to stay reachable on its own.
      accessible={!action}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      // Errors, warnings and confirmations appear in response to something; notes are just there.
      accessibilityLiveRegion={tone === 'info' ? 'none' : 'polite'}
      style={[styles.notice, { backgroundColor: palette.background }, style]}
    >
      <Icon name={icon ?? palette.icon} size={18} color={palette.accent} />
      <View style={styles.copy}>
        {title ? <Text variant="captionMedium">{title}</Text> : null}
        <Text variant="caption">{message}</Text>
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={10}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
        >
          <Text variant="captionMedium" style={{ color: palette.accent }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'center' },
  copy: { flex: 1, gap: 1 },
  notice: {
    alignItems: 'flex-start',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.6 },
});
