import {
  VEHICLE_CLASSES,
  formatDateTimeET,
  formatMoney,
  formatAddressLine,
  type PricedCheckout,
  type SavedCard,
} from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Notice, Text, Toggle } from '@/components/ui';
import { CardBrandMark } from '@/features/account/card/CardBrandMark';
import { CARD_BRAND_LABEL, expiryLabel } from '@/features/account/card/card-format';
import { TestModeNotice } from '@/features/cards/TestModeNotice';
import { useCart } from '@/features/cart/CartProvider';
import { useNow } from '@/hooks/useNow';
import { colors, spacing } from '@/theme/tokens';

import { AddOptionButton } from './AddOptionButton';
import { AmountRows } from './AmountRows';
import type { Checkout } from './useCheckout';

/** "Need help unloading? Add a labourer", per eligible store with its price; locked on when required. */
export function UnloadHelpCard({ checkout }: { checkout: Checkout }) {
  const cart = useCart();
  const stores = (checkout.pricing?.stores ?? []).filter((store) => store.unload.offered);
  if (stores.length === 0) return null;
  return (
    <Card style={styles.card}>
      <Text variant="heading">Need help unloading?</Text>
      {stores.map((priced) => {
        const store = checkout.groups.find((group) => group.storeId === priced.storeId)?.store;
        const fee = priced.vehicleClass ? VEHICLE_CLASSES[priced.vehicleClass].labourerFeeCents : null;
        const name = store?.name ?? 'This store';
        return (
          <View key={priced.storeId} style={styles.unloadRow}>
            <View style={styles.flex}>
              <Text variant="bodyMedium">
                Add a labourer · {formatMoney(priced.unload.required ? priced.unload.feeCents : fee)}
              </Text>
              <Text variant="caption" color="muted">
                {priced.unload.required
                  ? `Required for ${name}: the site is unattended and the load is heavy`
                  : `For the delivery from ${name}`}
              </Text>
            </View>
            <Toggle
              label={`Add a labourer for ${name}`}
              value={priced.unload.selected}
              disabled={priced.unload.required}
              onValueChange={(on) => cart.setUnloadHelp(priced.storeId, on)}
            />
          </View>
        );
      })}
    </Card>
  );
}

/** Pickup mode: each store's ready time, how long it holds the order, and its address. */
export function PickupCard({ checkout }: { checkout: Checkout }) {
  const now = useNow(30_000);
  return (
    <Card style={styles.card}>
      <Text variant="heading">Pickup</Text>
      {checkout.pickups.map(({ storeId, store, promise }) => (
        <View key={storeId} style={styles.pickupRow} accessible>
          <View style={styles.pin}>
            <Icon name="home" size={16} color={colors.primaryDark} />
          </View>
          <View style={styles.flex}>
            <Text variant="bodyMedium">{store.name}</Text>
            {promise.ok ? (
              <>
                <Text variant="captionMedium" color="primaryDark">
                  {promise.label}
                </Text>
                {promise.holdUntil != null ? (
                  <Text variant="caption" color="muted">
                    Held until {formatDateTimeET(promise.holdUntil, now)}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="caption" color="danger">
                {promise.reason}
              </Text>
            )}
            <Text variant="caption" color="muted">
              {formatAddressLine(store.address)}
            </Text>
          </View>
        </View>
      ))}
      <Text variant="caption" color="muted">
        Show the pickup PIN at the counter. It appears on your order once the store has it ready.
      </Text>
    </Card>
  );
}

function CardLine({ card, expired }: { card: SavedCard; expired: boolean }) {
  const expiry = expiryLabel(card.expMonth, card.expYear);
  return (
    <View
      style={styles.cardLine}
      accessible
      accessibilityLabel={`${CARD_BRAND_LABEL[card.brand]} ending ${card.last4}, expires ${expiry}`}
    >
      <View style={styles.brand}>
        <CardBrandMark brand={card.brand} tone="dark" scale={0.6} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyMedium">
          {CARD_BRAND_LABEL[card.brand]} •••• {card.last4}
        </Text>
        <Text variant="caption" color={expired ? 'danger' : 'muted'}>
          {expired ? `Expired ${expiry}` : `Expires ${expiry}`}
        </Text>
      </View>
      <Text variant="captionMedium" color="primaryDark">
        Change
      </Text>
    </View>
  );
}

/** The card (→ `checkout/card`) and the test-mode note. */
export function PaymentCard({ checkout, testMode }: { checkout: Checkout; testMode: boolean }) {
  return (
    <Card style={styles.card}>
      <Text variant="heading">Payment</Text>
      {checkout.paymentsDisabled ? (
        <Notice
          tone="warning"
          title="Card payments aren't available yet"
          message="Your cart is saved. Try again later."
        />
      ) : checkout.card ? (
        <Card
          padded={false}
          style={styles.cardButton}
          onPress={() => router.push('/checkout/card')}
          accessibilityLabel="Change card"
        >
          <CardLine card={checkout.card} expired={checkout.cardExpired} />
        </Card>
      ) : (
        <AddOptionButton
          label="Add a card"
          caption="Visa, Mastercard, Amex or Discover"
          onPress={() => router.push({ pathname: '/cards/add', params: { select: '1' } })}
        />
      )}
      <Text variant="caption" color="muted">
        Your card is held when you order and charged when your order is complete, for what was supplied.
      </Text>
      {testMode ? <TestModeNotice /> : null}
    </Card>
  );
}

/** Summary per store (items, ~~list fee~~/fee, labourer, discount, HST, total) and the order total. */
/**
 * The order's breakdown. After `PRICE_CHANGED` it shows the server's `serverPricing` (what the button
 * now charges) with a "Prices updated" tag, so the rows always add up to the button's total.
 */
export function OrderSummaryCard({
  checkout,
  serverPricing = null,
}: {
  checkout: Checkout;
  serverPricing?: PricedCheckout | null;
}) {
  const pricing = serverPricing ?? checkout.pricing;
  if (!pricing) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.summaryTitle}>
        <Text variant="heading">Summary</Text>
        {serverPricing ? <Badge label="Prices updated" tone="warning" /> : null}
      </View>
      {pricing.stores.map((priced) => {
        const store = checkout.groups.find((group) => group.storeId === priced.storeId)?.store;
        return (
          <View key={priced.storeId} style={styles.storeSummary}>
            <Text variant="captionMedium" color="muted">
              {priced.letter} · {store?.name ?? 'Store'}
            </Text>
            <AmountRows
              amounts={priced}
              delivery={checkout.delivery}
              deliveryListCents={priced.deliveryFeeListCents}
              totalLabel="Store total"
            />
          </View>
        );
      })}
      {pricing.stores.length > 1 ? (
        <View style={styles.storeSummary}>
          <Text variant="captionMedium" color="muted">
            Order total
          </Text>
          <AmountRows
            amounts={pricing}
            delivery={checkout.delivery}
            deliveryListCents={pricing.stores.reduce((sum, store) => sum + store.deliveryFeeListCents, 0)}
            discounts={pricing.discounts}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 6,
    height: 32,
    justifyContent: 'center',
    width: 48,
  },
  card: { gap: spacing.md },
  cardButton: { backgroundColor: colors.surfaceMuted },
  cardLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  flex: { flex: 1 },
  pickupRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  pin: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  summaryTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  storeSummary: { gap: spacing.sm },
  unloadRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
