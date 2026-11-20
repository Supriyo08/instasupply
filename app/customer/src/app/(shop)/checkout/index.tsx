import { formatMoney } from '@instasupply/shared';
import { useConfig } from '@instasupply/api-client/react';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorState, Header, Notice, Screen, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { resetCheckoutDraft, updateCheckoutDraft } from '@/features/checkout/checkout-draft';
import {
  OrderSummaryCard,
  PaymentCard,
  PickupCard,
  UnloadHelpCard,
} from '@/features/checkout/CheckoutExtras';
import {
  DeliveryOptionsCard,
  InstructionsCard,
  JobsiteCard,
  ReceivingCard,
} from '@/features/checkout/DeliverySection';
import { EmptyCart, fillContent } from '@/features/checkout/EmptyCart';
import { FulfilmentBar } from '@/features/checkout/FulfilmentBar';
import { ScrollBody, scrollBodyContainer, useKeyboardReveal } from '@/features/checkout/KeyboardScroll';
import { problemFor, type CheckoutProblem } from '@/features/checkout/place-order-errors';
import { PromoField } from '@/features/checkout/PromoField';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { useCheckout } from '@/features/checkout/useCheckout';
import { placeOrder } from '@/features/orders/hooks';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { errorCodeOf } from '@/lib/api';
import { newRequestId } from '@/lib/ids';
import { spacing } from '@/theme/tokens';

function Checkout() {
  const { user } = useCustomer();
  const cart = useCart();
  const checkout = useCheckout(user.uid);
  const config = useConfig();
  const keyboard = useKeyboardReveal();
  // One id per checkout attempt, kept across retries: a retry after a lost answer returns the same order.
  const [checkoutId] = useState(() => newRequestId());
  const [placing, setPlacing] = useState(false);
  // A second tap before the first answer must not send a second request.
  const inFlight = useRef(false);
  const [sent, setSent] = useState<{ problem: CheckoutProblem; priceKey: string } | null>(null);
  // What the total depends on: a `PRICE_CHANGED` answer only stands until one of these changes.
  const priceKey = JSON.stringify([
    cart.lines.map((line) => [line.storeId, line.productId, line.quantity]),
    cart.fulfilment,
    cart.promoCode,
    cart.unloadHelpStoreIds,
    checkout.jobsite?.id ?? null,
    checkout.receiving,
  ]);
  const problem =
    sent && (sent.problem.newTotalCents == null || sent.priceKey === priceKey) ? sent.problem : null;
  const setProblem = (next: CheckoutProblem | null) => setSent(next ? { problem: next, priceKey } : null);

  const header = <Header title="Checkout" />;
  if (!cart.ready || (checkout.loading && cart.lines.length > 0)) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={4} label="Loading checkout" />
      </Screen>
    );
  }
  if (cart.lines.length === 0) {
    return (
      <Screen header={header} contentStyle={fillContent}>
        <EmptyCart message="Add supplies from stores near your jobsite, then come back to check out." />
      </Screen>
    );
  }
  if (checkout.error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load checkout" error={checkout.error} onRetry={checkout.retry} />
      </Screen>
    );
  }

  const storeName = (storeId: string) =>
    checkout.groups.find((group) => group.storeId === storeId)?.store?.name ?? 'One store';
  const total = problem?.newTotalCents ?? checkout.pricing?.totalCents ?? null;

  const place = async () => {
    const request = checkout.request(checkoutId, problem?.newTotalCents ?? undefined);
    if (!request || inFlight.current) return;
    inFlight.current = true;
    setPlacing(true);
    setProblem(null);
    try {
      const result = await placeOrder(request);
      // Drop cart and checkout from the history: back from the success screen leads home.
      router.dismissTo('/');
      router.push({
        pathname: '/order-success',
        params: { orderId: result.orderId, number: result.number, total: String(result.totalCents) },
      });
      cart.clear();
      resetCheckoutDraft();
    } catch (error) {
      if (errorCodeOf(error) === 'CARD_DECLINED') updateCheckoutDraft({ declinedCardId: request.cardId });
      setProblem(
        problemFor(error, cart, {
          groups: checkout.groups,
          windowsKey: checkout.windowsKey,
          now: Date.now(),
        }),
      );
    } finally {
      inFlight.current = false;
      setPlacing(false);
    }
  };

  return (
    <Screen
      header={header}
      scroll={false}
      contentStyle={scrollBodyContainer}
      footer={
        <>
          {checkout.blocker ? (
            <Text variant="caption" color="muted" align="center">
              {checkout.blocker}
            </Text>
          ) : null}
          <Button
            label={total != null ? `Place order · ${formatMoney(total)}` : 'Place order'}
            loading={placing}
            disabled={checkout.blocker != null || placing}
            onPress={() => void place()}
          />
        </>
      }
    >
      <ScrollBody ref={keyboard.scrollRef}>
        <FulfilmentBar showSite={false} />
        {problem ? (
          <Notice
            tone={problem.newTotalCents != null ? 'warning' : 'danger'}
            title={problem.title}
            message={problem.message}
            actionLabel={problem.action?.label}
            onAction={problem.action?.run}
          />
        ) : null}
        {checkout.warnings
          .filter((warning) => warning.kind !== 'pricing' || warning.code !== 'no_dropoff')
          .map((warning, index) => (
            <Notice
              key={`${warning.kind}-${index}`}
              tone="danger"
              message={
                warning.storeId && warning.kind === 'pricing'
                  ? warning.message
                  : `${warning.storeId ? `${storeName(warning.storeId)}: ` : ''}${warning.message}`
              }
              actionLabel={warning.kind === 'pricing' ? undefined : 'Fix in cart'}
              onAction={() => router.dismissTo('/cart')}
            />
          ))}

        {checkout.delivery ? (
          <>
            <JobsiteCard checkout={checkout} />
            <ReceivingCard checkout={checkout} />
            <DeliveryOptionsCard checkout={checkout} />
            <View onLayout={keyboard.track('instructions')}>
              <InstructionsCard checkout={checkout} onFocus={() => keyboard.reveal('instructions')} />
            </View>
            <UnloadHelpCard checkout={checkout} />
          </>
        ) : (
          <PickupCard checkout={checkout} />
        )}

        <PaymentCard checkout={checkout} testMode={config?.paymentsMode === 'test'} />
        <View onLayout={keyboard.track('promo')}>
          <PromoField promo={checkout.pricing?.promo ?? null} onFocus={() => keyboard.reveal('promo')} />
        </View>
        <OrderSummaryCard checkout={checkout} serverPricing={problem?.serverPricing ?? null} />
        <Text variant="caption" color="muted" style={styles.note}>
          Each store packs its own part of the order. You can cancel a store’s items until it starts on them.
        </Text>
      </ScrollBody>
    </Screen>
  );
}

/** Checkout (MARKETPLACE §7.3, docs/CLIENTS.md §4.3): 🔒, priced as the server will price it. */
export default function CheckoutScreen() {
  return (
    <RequireAccount title="Checkout" message="Sign in to place your order. Your cart stays as it is.">
      <Checkout />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: spacing.xs },
});
