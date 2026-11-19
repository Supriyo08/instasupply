import { DEFAULT_COUNTRY_CODE } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { FormInput } from './FormInput';

/** "+91" country chip beside the mobile number field, as on the Big Cart "Verify number" screen. */
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
      <View style={styles.chip} accessible accessibilityLabel={`Country code India, ${DEFAULT_COUNTRY_CODE}`}>
        <IndiaFlag />
        <Text variant="bodyMedium">{DEFAULT_COUNTRY_CODE}</Text>
      </View>
      <View style={styles.field}>
        <FormInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder="Mobile number"
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

/** Small tricolour drawn with brand tokens (emoji flags do not render everywhere, e.g. Windows). */
function IndiaFlag() {
  return (
    <View style={styles.flag} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.stripe, { backgroundColor: colors.warning }]} />
      <View style={[styles.stripe, styles.middle]}>
        <View style={styles.wheel} />
      </View>
      <View style={[styles.stripe, { backgroundColor: colors.primaryDark }]} />
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
    height: 16,
    overflow: 'hidden',
    width: 24,
  },
  middle: { alignItems: 'center', backgroundColor: colors.white, justifyContent: 'center' },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm + 2 },
  stripe: { flex: 1 },
  wheel: { borderColor: colors.info, borderRadius: 2, borderWidth: 1, height: 4, width: 4 },
});
