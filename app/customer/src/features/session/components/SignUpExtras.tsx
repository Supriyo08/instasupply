import type { AccountType } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Chip, Text, Toggle } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { ACCOUNT_TYPE_OPTIONS } from './validation';

/** "I'm a…" chips (one or none) for the sign-up form; tapping the chosen one clears it. */
export function AccountTypeChips({
  value,
  onChange,
  disabled,
}: {
  value: AccountType | null;
  onChange: (value: AccountType | null) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="I'm a…">
      <Text variant="captionMedium" color="muted">
        I&apos;m a…
      </Text>
      <View style={styles.chips}>
        {ACCOUNT_TYPE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={value === option.value}
            disabled={disabled}
            accessibilityLabel={`I'm a ${option.label.toLowerCase()}`}
            onPress={() => onChange(value === option.value ? null : option.value)}
          />
        ))}
      </View>
    </View>
  );
}

/** The CASL opt-in: off unless the customer turns it on. */
export function DealsOptIn({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.optIn}>
      <View style={styles.optInCopy}>
        <Text variant="bodyMedium">Send me deals</Text>
        <Text variant="caption" color="muted">
          Promotions from local suppliers by email and push. Unsubscribe any time.
        </Text>
      </View>
      <Toggle label="Send me deals" value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  group: { gap: spacing.sm },
  optIn: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  optInCopy: { flex: 1, gap: 2 },
});
