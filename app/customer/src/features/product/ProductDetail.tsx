import { availableQty, formatMoney, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type NativeScrollEvent } from 'react-native';

import { Button, Notice, Screen } from '@/components/ui';
import { useListings } from '@/features/catalog/useListings';
import { browseOnlyReason, canOrderFrom, maxOrderQuantity } from '@/features/stores/status';
import { colors, radius, spacing } from '@/theme/tokens';

import { AlsoAt } from './AlsoAt';
import { NATIVE_DRIVER } from './constants';
import { ProductHero } from './ProductHero';
import { ProductInfo } from './ProductInfo';
import { ProductSpecs } from './ProductSpecs';
import { ProductTopBar } from './ProductTopBar';
import { QuantityPicker } from './QuantityPicker';
import { StoreRow } from './StoreRow';
import { useAddToCart } from './useAddToCart';
import { useHeroMetrics } from './useHeroMetrics';

/**
 * Product page (MARKETPLACE §7.3): art on the category pastel, price per unit, stock at the store,
 * quantity with bulk chips, details and load flags, the store row, "Also at" and a sticky
 * "Add to cart · $95.80". Save needs an account.
 */
export function ProductDetail({ product }: { product: Product }) {
  const hero = useHeroMetrics();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [solid, setSolid] = useState(false);
  const cart = useAddToCart();
  const inCart = cart.quantityOf(product.id);
  const [quantity, setQuantity] = useState(() => Math.max(1, inCart));
  const products = useMemo(() => [product], [product]);
  const { listings } = useListings(products);
  const view = listings[0]?.view ?? null;
  const available = availableQty(product);
  const max = maxOrderQuantity(product, available);
  const orderable = canOrderFrom(view?.store ?? null);
  const browseOnly = view ? browseOnlyReason(view.store) : null;
  const chosen = Math.min(quantity, Math.max(1, max));
  const total = formatMoney(product.priceCents * chosen);

  const onScroll = useMemo(
    () =>
      Animated.event<NativeScrollEvent>([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: NATIVE_DRIVER,
        listener: (event) => setSolid(event.nativeEvent.contentOffset.y >= hero.solidAt),
      }),
    [scrollY, hero.solidAt],
  );

  let action;
  if (!orderable) action = <Button label="Not taking orders" disabled />;
  else if (max <= 0) action = <Button label="Out of stock" disabled />;
  else if (inCart === 0) {
    action = (
      <Button
        label={`Add to cart · ${total}`}
        trailingIcon="shopping-bag"
        onPress={() => cart.set(product, chosen)}
      />
    );
  } else if (inCart !== chosen) {
    action = (
      <Button
        label={`Update cart · ${total}`}
        trailingIcon="shopping-bag"
        onPress={() => cart.set(product, chosen)}
      />
    );
  } else {
    action = (
      <Button
        label={`In cart: ${inCart} · View cart`}
        variant="secondary"
        onPress={() => router.push('/cart')}
      />
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.body} footer={action}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.fill}
        contentContainerStyle={styles.content}
      >
        <ProductHero product={product} height={hero.height} artSize={hero.artSize} soldOut={available <= 0} />
        <View style={styles.sheet}>
          <ProductInfo product={product} available={available} />
          {browseOnly ? <Notice tone="info" title="Browse only" message={browseOnly} /> : null}
          {orderable && max > 0 ? (
            <QuantityPicker
              value={chosen}
              onChange={setQuantity}
              max={max}
              label={product.name}
              unit={product.unit}
            />
          ) : null}
          <ProductSpecs product={product} />
          {view ? <StoreRow view={view} /> : null}
          <AlsoAt product={product} />
        </View>
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
