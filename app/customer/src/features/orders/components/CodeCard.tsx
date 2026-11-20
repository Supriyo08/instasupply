import { StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * A 4-digit code shown big in boxes: the pickup PIN for the counter, or the hand-off code the driver
 * asks for on site. Screen readers hear the digits one by one with the instructions.
 */
export function CodeCard({
  icon,
  title,
  subtitle,
  code,
  footnote,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  code: string;
  footnote?: string;
}) {
  const digits = code.replace(/\s/g, '').split('');
  const compact = digits.length > 4;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${title} ${digits.join(' ')}. ${subtitle}.${footnote ? ` ${footnote}` : ''}`}
    >
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name={icon} size={18} color={colors.primaryDark} />
        </View>
        <View style={styles.headerText}>
          <Text variant="heading">{title}</Text>
          <Text variant="caption" color="muted">
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.digits}>
        {digits.map((digit, index) => (
          <View key={index} style={[styles.digit, compact ? styles.digitCompact : null]}>
            <Text variant={compact ? 'title' : 'display'} color="primaryDark">
              {digit}
            </Text>
          </View>
        ))}
      </View>
      {footnote ? (
        <Text variant="caption" color="muted" align="center">
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  digit: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    height: 58,
    justifyContent: 'center',
    width: 50,
  },
  digitCompact: { height: 50, width: 38 },
  digits: { flexDirection: 'row', gap: spacing.sm + 2, justifyContent: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerText: { flex: 1 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
