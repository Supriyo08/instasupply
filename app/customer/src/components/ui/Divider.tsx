import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
});
