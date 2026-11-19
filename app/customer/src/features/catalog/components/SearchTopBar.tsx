import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Input } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/** Back arrow + autofocused search field (with a clear button) at the top of the search screen. */
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
    <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
      <IconButton
        icon="arrow-left"
        label="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <View style={styles.field}>
        <Input
          icon="search"
          placeholder="Search keywords.."
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          enterKeyHint="search"
          maxLength={60}
          style={styles.input}
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
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.gutter,
  },
  field: { flex: 1 },
  // The field's own green border shows focus; drop the browser's focus ring inside it on the web
  // (a 0px solid outline replaces Chrome's `outline-style: auto`, which ignores the width).
  input: { outlineStyle: 'solid', outlineWidth: 0 },
});
