import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Icon } from './Icon';
import { Text } from './Text';

/** "Categories   >" row used on the home screen. */
export function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={styles.row}>
      <Text variant="heading">{title}</Text>
      {onSeeAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See all ${title}`}
          hitSlop={8}
          onPress={onSeeAll}
        >
          <Icon name="chevron-right" size={22} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
