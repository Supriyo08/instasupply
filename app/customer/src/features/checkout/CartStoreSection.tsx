import { formatDistance, formatMoney } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Badge, Card, Divider, Icon, Notice, PromiseLabel, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import type { CartGroup, CartWarning } from '@/features/cart/useCartPricing';
import { colors, radius, spacing } from '@/theme/tokens';

import { kmLabel, loadLabel, sendAsMaterialList } from './cart-copy';
import { CartLineRow } from './CartLineRow';

/** A store-level warning with the fix the cart offers for it. */
function StoreWarning({ warning, group }: { warning: CartWarning; group: CartGroup }) {
  const cart = useCart();
  if (warning.kind !== 'pricing' && warning.kind !== 'missing_store') return null;
  if (warning.kind === 'missing_store') {
    return (
      <Notice
        tone="danger"
        message={warning.message}
        actionLabel="Remove"
        onAction={() => cart.removeStore(group.storeId)}
      />
    );
  }
  switch (warning.code) {
    case 'out_of_range':
      return (
        <Notice
          tone="warning"
          title="Pickup only from this store"
          message={warning.message}
          actionLabel={cart.fulfilment === 'delivery' ? 'Pickup' : undefined}
          onAction={() => cart.setFulfilment('pickup')}
        />
      );
    case 'too_large':
    case 'jobsite_vehicle_limit':
      return (
        <Notice
          tone="warning"
          title="Send as a material list"
          message={warning.message}
          actionLabel="Send list"
          onAction={() => sendAsMaterialList(group)}
        />
      );
    case 'pickup_unavailable':
      return (
        <Notice
          tone="warning"
          message={warning.message}
          actionLabel="Delivery"
          onAction={() => cart.setFulfilment('delivery')}
        />
      );
    default:
      return <Notice tone="danger" message={warning.message} />;
  }
}

/**
 * One store's part of the cart (MARKETPLACE §7.3): header with distance and promise, its lines,
 * subtotal, load chip, delivery fee preview and the warnings that stop it from being ordered.
 */
export function CartStoreSection({
  group,
  onRemoveLine,
}: {
  group: CartGroup;
  onRemoveLine: (productId: string) => void;
}) {
  const cart = useCart();
  const { store, view, priced } = group;
  const name = store?.name ?? 'Store no longer on InstaSupply';
  const distance = kmLabel(priced) ?? (view?.distanceM != null ? formatDistance(view.distanceM) : null);
  const delivery = cart.fulfilment === 'delivery';
  const lineWarning = (productId: string) =>
    group.warnings.find((warning) => 'productId' in warning && warning.productId === productId) ?? null;

  return (
    <Card style={styles.card} accessibilityLabel={`Items from ${name}`}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${name}`}
        disabled={!store}
        onPress={() => store && router.push({ pathname: '/store/[id]', params: { id: store.id } })}
        style={styles.header}
      >
        <View style={styles.storeArt}>
          <ArtImage artKey={store?.imageKey ?? 'store-hardware'} uri={store?.photoUrl ?? null} size={36} />
        </View>
        <View style={styles.headerBody}>
          <Text variant="heading" numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.meta}>
            {distance ? (
              <Text variant="caption" color="muted">
                {distance}
              </Text>
            ) : null}
            {view?.availability.badge ? <Badge label={view.availability.badge} tone="warning" /> : null}
          </View>
          {view ? <PromiseLabel promise={view.availability.promise} size="sm" /> : null}
        </View>
        {store ? <Icon name="chevron-right" size={18} color={colors.textMuted} /> : null}
      </Pressable>

      <Divider />
      {group.lines.map((entry) => (
        <CartLineRow
          key={entry.line.productId}
          entry={entry}
          warning={lineWarning(entry.line.productId)}
          onChange={(quantity) =>
            cart.setQuantity({ id: entry.line.productId, storeId: entry.line.storeId }, quantity)
          }
          onRemove={() => onRemoveLine(entry.line.productId)}
        />
      ))}

      {group.warnings.map((warning, index) => (
        <StoreWarning key={`${warning.kind}-${index}`} warning={warning} group={group} />
      ))}

      {priced ? (
        <View style={styles.footer}>
          <View style={styles.chips}>
            <View
              style={styles.chip}
              accessible
              accessibilityLabel={`Load: ${loadLabel(priced.load, priced.vehicleClass)}`}
            >
              <Icon name="truck" size={13} color={colors.textMuted} />
              <Text variant="captionMedium" color="muted">
                {loadLabel(priced.load, priced.vehicleClass)}
              </Text>
            </View>
          </View>
          <View style={styles.amountRow}>
            <Text color="muted">Subtotal</Text>
            <Text variant="bodyMedium">{formatMoney(priced.itemsCents)}</Text>
          </View>
          {delivery ? (
            <View style={styles.amountRow}>
              <Text color="muted">Delivery</Text>
              {priced.feeWaiver && priced.deliveryFeeListCents > 0 ? (
                <View
                  style={styles.fee}
                  accessible
                  accessibilityLabel={`Delivery ${formatMoney(priced.deliveryFeeListCents)}, waived: free`}
                >
                  <Text color="subtle" style={styles.struck}>
                    {formatMoney(priced.deliveryFeeListCents)}
                  </Text>
                  <Text variant="bodyMedium" color="primaryDark">
                    Free
                  </Text>
                </View>
              ) : (
                <Text variant="bodyMedium">{formatMoney(priced.deliveryFeeCents)}</Text>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove every item from ${name}`}
        onPress={() => cart.removeStore(group.storeId)}
        style={styles.removeStore}
      >
        <Text variant="captionMedium" color="danger">
          Remove this store
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  amountRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  card: { gap: spacing.md },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fee: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  footer: { gap: spacing.sm },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerBody: { flex: 1, gap: 2 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  removeStore: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  storeArt: {
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  struck: { textDecorationLine: 'line-through' },
});
