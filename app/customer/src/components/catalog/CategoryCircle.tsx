import type { Category } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Text } from '@/components/ui';

/** Pastel circle + label (home screen category row and categories grid). */
export function CategoryCircle({ category, size = 52 }: { category: Category; size?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={category.name}
      onPress={() => router.push(`/category/${category.id}`)}
      style={({ pressed }) => [styles.item, { width: size + 20, opacity: pressed ? 0.7 : 1 }]}
    >
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: category.tint },
        ]}
      >
        <ArtImage artKey={category.iconKey} size={size * 0.56} />
      </View>
      <Text variant="micro" color="muted" numberOfLines={1} align="center">
        {category.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  item: { alignItems: 'center', gap: 6 },
});
