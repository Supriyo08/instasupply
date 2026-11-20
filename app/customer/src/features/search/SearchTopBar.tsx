import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Input, webColumn } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/** White band with a back arrow and the autofocused search field (with a clear button). */
export function SearchTopBar({
  value,
  onChangeText,
  onSubmit,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.band, { paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.bar, webColumn]}>
        <IconButton
          icon="arrow-left"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <View style={styles.field}>
          <Input
            icon="search"
            placeholder="Search 2x4, drywall, PEX…"
            accessibilityLabel="Search products"
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            tone="muted"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            enterKeyHint="search"
            maxLength={60}
            trailing={
              value ? (
                <IconButton
                  icon="x"
                  label="Clear search"
                  size={28}
                  color={colors.textMuted}
                  onPress={() => onChangeText('')}
                />
              ) : null
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { backgroundColor: colors.surface, paddingBottom: spacing.sm },
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.gutter,
  },
  field: { flex: 1 },
});
