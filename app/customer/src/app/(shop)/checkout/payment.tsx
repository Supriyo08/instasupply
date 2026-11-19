import { describeError } from '@instasupply/expo-firebase';
import type { PaymentMethod, SavedCard } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Header, Input, Notice, Screen, Skeleton, Text } from '@/components/ui';
import { useAddresses } from '@/features/addresses/hooks';
import { useCards } from '@/features/cards/hooks';
import { useCart } from '@/features/cart/CartProvider';
import { useCartDetails } from '@/features/cart/useCartDetails';
import { isCardUsable } from '@/features/checkout/CardOption';
import { CartErrorNotice } from '@/features/checkout/CartErrorNotice';
import { DeliveryAddressCard } from '@/features/checkout/DeliveryAddressCard';
import { EmptyCart, fillContent } from '@/features/checkout/EmptyCart';
import { ScrollBody, scrollBodyContainer, useKeyboardReveal } from '@/features/checkout/KeyboardScroll';
import { reviewCart, singleParam } from '@/features/checkout/navigation';
import { OrderSummaryCard } from '@/features/checkout/OrderSummaryCard';
import { PaymentSection } from '@/features/checkout/PaymentSection';
import { PlaceOrderFooter } from '@/features/checkout/PlaceOrderFooter';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { StepProgress } from '@/features/checkout/StepProgress';
import { useChoice } from '@/features/checkout/useChoice';
import { usePlaceOrder } from '@/features/checkout/usePlaceOrder';
import { useCustomer } from '@/features/session/SessionProvider';
import { colors, radius } from '@/theme/tokens';

const NOTES_MAX = 300;

/** The default card if it is still valid, else the first card that hasn't expired. */
function pickDefaultCard(cards: readonly SavedCard[]) {
  const usable = cards.filter(isCardUsable);
  return usable.find((card) => card.isDefault) ?? usable[0] ?? null;
}

const changeAddress = () => router.dismissTo('/checkout/address');

export default function PaymentMethodScreen() {
  const { user } = useCustomer();
  const cart = useCart();
  const params = useLocalSearchParams<{ addressId?: string | string[] }>();
  const addressId = singleParam(params.addressId);
  const details = useCartDetails(user.uid);
  const addresses = useAddresses(user.uid);
  const cards = useCards(user.uid);
  const cardChoice = useChoice<SavedCard>(cards.data, pickDefaultCard);
  const [method, setMethod] = useState<PaymentMethod>('cod');
  const [notes, setNotes] = useState('');
  const order = usePlaceOrder();
  const keyboard = useKeyboardReveal();
  const header = <Header title="Payment Method" />;

  if (order.placed) {
    // The cart is already empty; hold this view for the moment before the receipt opens.
    return (
      <Screen
        header={<Header title="Payment Method" back={false} />}
        scroll={false}
        contentStyle={styles.placed}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text color="muted" align="center">
          Order placed! Opening your receipt…
        </Text>
      </Screen>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <Screen header={header} contentStyle={fillContent}>
        <EmptyCart message="Add something to your cart before choosing how to pay." />
      </Screen>
    );
  }

  // Without an address in the link (e.g. opened directly), fall back to the default address.
  const address = addressId
    ? (addresses.data.find((entry) => entry.id === addressId) ?? null)
    : addresses.defaultAddress;
  const addressLoading = addresses.loading && addresses.data.length === 0;
  const itemsLoading = details.loading && details.items.length === 0;
  // No prices to show: the cart is still loading, or it couldn't be loaded.
  const pricesUnknown = itemsLoading || details.error != null;
  const card = method === 'card' ? cardChoice.selected : null;
  const { priced } = details;

  const ready = details.canCheckout && address != null && (method === 'cod' || card != null);
  // Explain what's missing, but not while it is still loading.
  const hint =
    ready || itemsLoading || addressLoading || details.loading
      ? null
      : details.error
        ? "We couldn't load your cart."
        : !details.canCheckout
          ? 'Review your cart to continue.'
          : !address
            ? 'Choose a delivery address to continue.'
            : cards.loading
              ? null
              : 'Choose a saved card or add a new one.';

  const submit = () => {
    if (!address || (method === 'card' && !card)) return;
    void order.place({
      items: cart.lines,
      addressId: address.id,
      paymentMethod: method,
      cardId: card?.id ?? null,
      // Only send a code that applies; the server rejects orders with an invalid one.
      promoCode: priced.promo?.code ?? null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Screen
      header={header}
      scroll={false}
      contentStyle={scrollBodyContainer}
      footer={
        <PlaceOrderFooter
          total={priced.total}
          loading={pricesUnknown}
          placing={order.placing}
          disabled={!ready || order.placing}
          hint={hint}
          onPlace={submit}
        />
      }
    >
      <ScrollBody ref={keyboard.scrollRef}>
        <StepProgress current={2} />

        {order.error ? (
          <Notice
            tone="danger"
            title="Your order wasn't placed"
            message={order.error}
            // Address problems (deleted, can't be located) are fixed on the previous step.
            actionLabel={/address/i.test(order.error) ? 'Change address' : 'Review cart'}
            onAction={/address/i.test(order.error) ? changeAddress : reviewCart}
          />
        ) : null}

        {details.error ? (
          <CartErrorNotice error={details.error} onRetry={details.retry} />
        ) : !details.loading && !details.canCheckout ? (
          <Notice
            tone="warning"
            title="Your cart changed"
            message="Some items sold out or have less stock than you picked."
            actionLabel="Review cart"
            onAction={reviewCart}
          />
        ) : null}

        {addressLoading ? (
          <OptionCardsSkeleton count={1} label="Loading your delivery address" />
        ) : address ? (
          <DeliveryAddressCard address={address} onChange={changeAddress} />
        ) : (
          <Notice
            tone="warning"
            title="Choose a delivery address"
            message={
              addresses.error
                ? describeError(addresses.error, "We couldn't load your addresses.")
                : 'The address you picked is no longer saved.'
            }
            actionLabel="Choose"
            onAction={changeAddress}
          />
        )}

        <PaymentSection
          method={method}
          onMethodChange={setMethod}
          total={pricesUnknown ? null : priced.total}
          cards={cards.data}
          cardsLoading={cards.loading}
          cardsError={cards.error}
          onRetryCards={cards.retry}
          selectedCardId={card?.id ?? null}
          onSelectCard={cardChoice.choose}
          onAddCard={() => {
            cardChoice.beginAdd();
            router.push({ pathname: '/cards/add', params: { returnTo: 'checkout' } });
          }}
        />

        <View style={styles.section} onLayout={keyboard.track('notes')}>
          <Text variant="heading">Delivery notes</Text>
          <Input
            icon="edit-3"
            placeholder="Add a note for the driver (optional)"
            value={notes}
            onChangeText={setNotes}
            onFocus={() => keyboard.reveal('notes')}
            maxLength={NOTES_MAX}
            returnKeyType="done"
            hint={
              notes.length > NOTES_MAX - 50
                ? `${notes.length}/${NOTES_MAX}`
                : 'Gate code, landmark or when to call.'
            }
          />
        </View>

        {details.error ? null : itemsLoading ? (
          <Skeleton style={styles.summarySkeleton} />
        ) : (
          <OrderSummaryCard
            items={details.items.filter((item) => !item.unavailable)}
            priced={priced}
            promoCode={cart.promoCode}
            onEditCart={reviewCart}
          />
        )}
      </ScrollBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placed: { alignItems: 'center', gap: 16, justifyContent: 'center' },
  section: { gap: 10 },
  summarySkeleton: { borderRadius: radius.md, height: 220 },
});
