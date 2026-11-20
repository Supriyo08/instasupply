import { StyleSheet, View } from 'react-native';

import { Icon, Notice, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/** The test-mode banner (`useConfig().paymentsMode === 'test'`, MARKETPLACE §3.8). */
export function TestModeNotice() {
  return (
    <Notice
      tone="info"
      icon="shield"
      title="Test mode"
      message="No money is charged. Use a test card such as 4242 4242 4242 4242 with any future expiry. We only keep the brand, last 4 digits and expiry."
    />
  );
}

const BRANDS = ['Visa', 'Mastercard', 'American Express', 'Discover'] as const;

/** Which cards work: credit or debit on the four networks; Interac debit can't pay in the app. */
export function AcceptedCards() {
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`We take ${BRANDS.join(', ')}, credit or debit. Interac debit cards can't pay in the app.`}
    >
      <View style={styles.row}>
        <Icon name="credit-card" size={14} color={colors.textMuted} />
        <Text variant="captionMedium" color="muted">
          {BRANDS.join(' · ')}, credit or debit
        </Text>
      </View>
      <Text variant="caption" color="muted">
        Visa Debit and Debit Mastercard work like Visa and Mastercard. Interac debit cards can’t pay in the
        app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  wrap: { gap: spacing.xxs },
});
