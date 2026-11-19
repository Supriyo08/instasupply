import type { Product } from '@instasupply/shared';
import { useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type NativeScrollEvent } from 'react-native';

import { Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { NATIVE_DRIVER } from './constants';
import { ProductHero } from './ProductHero';
import { ProductInfo } from './ProductInfo';
import { ProductTopBar } from './ProductTopBar';
import { PurchaseButton } from './PurchaseButton';
import { QuantityRow } from './QuantityRow';
import { RelatedProducts } from './RelatedProducts';
import { useHeroMetrics } from './useHeroMetrics';
import { useProductPurchase } from './useProductPurchase';

/**
 * Big Cart "Organic Lemons" page: pastel hero with large art under a floating header, a grey
 * sheet with price, rating, description and quantity, related products, and a pinned
 * "Add to cart" button.
 */
export function ProductDetail({ product }: { product: Product }) {
  const hero = useHeroMetrics();
  const purchase = useProductPurchase(product);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [solid, setSolid] = useState(false);

  const onScroll = useMemo(
    () =>
      Animated.event<NativeScrollEvent>([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: NATIVE_DRIVER,
        listener: (event) => setSolid(event.nativeEvent.contentOffset.y >= hero.solidAt),
      }),
    [scrollY, hero.solidAt],
  );

  return (
    <Screen scroll={false} contentStyle={styles.body} footer={<PurchaseButton purchase={purchase} />}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.fill}
        contentContainerStyle={styles.content}
      >
        <ProductHero product={product} height={hero.height} artSize={hero.artSize} />
        <View style={styles.sheet}>
          <ProductInfo product={product} />
          {purchase.available ? <QuantityRow purchase={purchase} /> : null}
        </View>
        <RelatedProducts product={product} />
      </Animated.ScrollView>
      <ProductTopBar scrollY={scrollY} solidAt={hero.solidAt} solid={solid} title={product.name} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 0 },
  content: { paddingBottom: spacing.xxl },
  fill: { flex: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    gap: spacing.lg,
    marginTop: -radius.xl,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xxl,
  },
});
