import { StyleSheet, View } from 'react-native';

import { Header, Screen, Skeleton } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { HeroBackdrop } from './HeroBackdrop';
import { useHeroMetrics } from './useHeroMetrics';

/** Placeholder with the product page's shape while the product loads. */
export function ProductDetailSkeleton() {
  const hero = useHeroMetrics();
  const art = Math.round(hero.artSize * 0.75);
  return (
    <Screen scroll={false} contentStyle={styles.body}>
      <View accessible accessibilityLabel="Loading product" style={styles.fill}>
        <View style={[styles.hero, { height: hero.height }]}>
          <HeroBackdrop tint={colors.primaryTint} />
          <Skeleton style={{ borderRadius: art / 2, height: art, width: art }} />
        </View>
        <View style={styles.sheet}>
          <Skeleton style={styles.price} />
          <Skeleton style={styles.name} />
          <Skeleton style={styles.unit} />
          <Skeleton style={styles.rating} />
          <Skeleton style={styles.paragraph} />
          <Skeleton style={styles.quantity} />
        </View>
      </View>
      <View style={styles.bar}>
        <Header transparent />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { left: 0, position: 'absolute', right: 0, top: 0 },
  body: { paddingTop: 0 },
  fill: { flex: 1 },
  hero: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
    paddingBottom: 44,
  },
  name: { height: 26, width: '62%' },
  paragraph: { height: 66, width: '100%' },
  price: { height: 20, width: 84 },
  quantity: { height: 54, marginTop: spacing.sm, width: '100%' },
  rating: { height: 14, width: 150 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    flex: 1,
    gap: spacing.md,
    marginTop: -radius.xl,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xxl,
  },
  unit: { height: 12, width: 60 },
});
