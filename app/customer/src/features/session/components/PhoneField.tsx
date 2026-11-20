import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { FormInput } from './FormInput';
import { COUNTRY_CODE } from './phone';

/** "+1" country chip beside the mobile number field, as on the Big Cart "Verify number" screen. */
export function PhoneField({
  value,
  onChangeText,
  onSubmitEditing,
  error,
  editable = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  error?: string | null;
  editable?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.chip} accessible accessibilityLabel={`Country code Canada, ${COUNTRY_CODE}`}>
        <CanadaFlag />
        <Text variant="bodyMedium">{COUNTRY_CODE}</Text>
      </View>
      <View style={styles.field}>
        <FormInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder="(416) 555-0110"
          keyboardType="phone-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          returnKeyType="done"
          maxLength={18}
          autoFocus={!value}
          editable={editable}
          error={error}
        />
      </View>
    </View>
  );
}

/** A simple red-white-red flag drawn with tokens (emoji flags do not render everywhere, e.g. Windows). */
function CanadaFlag() {
  return (
    <View style={styles.flag} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.stripe, styles.red]} />
      <View style={[styles.stripe, styles.middle]}>
        <View style={styles.leaf} />
      </View>
      <View style={[styles.stripe, styles.red]} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 56,
    paddingHorizontal: 14,
  },
  field: { flex: 1 },
  flag: {
    borderColor: colors.border,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 16,
    overflow: 'hidden',
    width: 24,
  },
  leaf: {
    backgroundColor: colors.danger,
    borderRadius: 1,
    height: 6,
    transform: [{ rotate: '45deg' }],
    width: 6,
  },
  middle: { alignItems: 'center', backgroundColor: colors.white, flex: 2, justifyContent: 'center' },
  red: { backgroundColor: colors.danger },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm + 2 },
  stripe: { flex: 1 },
});
