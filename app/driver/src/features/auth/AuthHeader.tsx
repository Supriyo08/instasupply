import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={[styles.logo, { backgroundColor: colors.primary }]}>
        <Icon name="cube" size={26} color={colors.onPrimary} />
      </View>
      <Text variant="display">{title}</Text>
      <Text color="muted">{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8, marginBottom: 8, marginTop: 24 },
  logo: {
    alignItems: 'center',
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    marginBottom: 8,
    width: 52,
  },
});
