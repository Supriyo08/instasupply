import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Text, webColumn, type IconName } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { colors, gradient, shadows } from '@/theme/tokens';

const ICONS: Record<string, IconName> = {
  index: 'home',
  stores: 'map-pin',
  orders: 'file-text',
  account: 'user',
};

/** Big Cart bottom bar: Home · Stores · Orders · Account on the left and a floating gradient cart button. */
export function ShopTabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const cart = useCart();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {/* The white bar runs edge to edge; on the web its buttons keep to the content column. */}
      <View style={[styles.row, webColumn]}>
        <View style={styles.icons}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const label = descriptors[route.key]?.options.title ?? route.name;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
                onPress={() => {
                  if (!focused) navigateToTab(route.key);
                }}
                style={styles.tab}
              >
                <Icon
                  name={ICONS[route.name] ?? 'circle'}
                  size={22}
                  color={focused ? colors.text : colors.textMuted}
                />
                {focused ? <View style={styles.dot} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cart, ${cart.count} items`}
          onPress={() => router.push('/cart')}
          style={({ pressed }) => [
            styles.cartWrap,
            shadows.brand,
            { transform: [{ scale: pressed ? 0.95 : 1 }] },
          ]}
        >
          <LinearGradient
            colors={gradient.colors}
            start={gradient.start}
            end={gradient.end}
            style={styles.cart}
          >
            <Icon name="shopping-bag" size={24} color={colors.white} />
          </LinearGradient>
          {cart.count > 0 ? (
            <View style={styles.badge}>
              <Text variant="micro" color="white">
                {cart.count > 99 ? '99+' : cart.count}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.white,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -4,
    top: -6,
  },
  bar: { backgroundColor: colors.surface, paddingTop: 12 },
  cart: { alignItems: 'center', borderRadius: 30, height: 60, justifyContent: 'center', width: 60 },
  cartWrap: { borderRadius: 30, marginTop: -34 },
  dot: { backgroundColor: colors.primary, borderRadius: 2, height: 4, marginTop: 4, width: 4 },
  icons: { flex: 1, flexDirection: 'row', gap: 34 },
  row: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 24 },
  tab: { alignItems: 'center', minWidth: 32 },
});
