import { Platform, Switch } from 'react-native';

import { colors } from '@/theme/tokens';

// react-native-web colours the "on" thumb with its web-only `activeThumbColor` prop (Material teal
// by default). It is not in the React Native typings, so it is spread in.
const webThumb = Platform.OS === 'web' ? { activeThumbColor: colors.white } : null;

export function Toggle({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      trackColor={{ true: colors.primary, false: colors.border }}
      // iOS keeps its native white thumb (with shadow); Android and the web need it set.
      thumbColor={Platform.OS === 'ios' ? undefined : colors.white}
      {...webThumb}
    />
  );
}
