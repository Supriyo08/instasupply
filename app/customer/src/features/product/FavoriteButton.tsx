import { describeError } from '@instasupply/expo-firebase';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { FilledIcon, Icon } from '@/components/ui';
import { useFavorites } from '@/features/favorites/FavoritesProvider';
import { notify } from '@/lib/notify';
import { colors } from '@/theme/tokens';

import { NATIVE_DRIVER } from './constants';

/** Heart toggle for the product page, with a small "pop" when tapped. */
export function FavoriteButton({ productId, name }: { productId: string; name: string }) {
  const favorites = useFavorites();
  const active = favorites.isFavorite(productId);
  const scale = useRef(new Animated.Value(1)).current;

  const onPress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.3, duration: 110, useNativeDriver: NATIVE_DRIVER }),
      Animated.spring(scale, { toValue: 1, friction: 3, useNativeDriver: NATIVE_DRIVER }),
    ]).start();
    favorites
      .toggle(productId)
      .catch((error: unknown) => notify("Couldn't update favorites", describeError(error)));
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `Remove ${name} from favorites` : `Save ${name} to favorites`}
      accessibilityState={{ selected: active }}
      hitSlop={10}
      onPress={onPress}
      style={styles.button}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {active ? (
          <FilledIcon name="heart" size={24} color={colors.danger} />
        ) : (
          <Icon name="heart" size={22} color={colors.textMuted} />
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', height: 40, justifyContent: 'center', marginRight: -8, width: 40 },
});
