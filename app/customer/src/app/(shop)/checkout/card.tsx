import { useConfig } from '@instasupply/api-client/react';
import { isFutureExpiry } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorState, Header, Notice, Screen, Text } from '@/components/ui';
import { CardBrandMark } from '@/features/account/card/CardBrandMark';
import { CARD_BRAND_LABEL, expiryLabel } from '@/features/account/card/card-format';
import { TestModeNotice } from '@/features/cards/TestModeNotice';
import { AddOptionButton } from '@/features/checkout/AddOptionButton';
import { updateCheckoutDraft, useCheckoutDraft } from '@/features/checkout/checkout-draft';
import { OptionRow } from '@/features/checkout/OptionRow';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { useCheckout } from '@/features/checkout/useCheckout';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useNow } from '@/hooks/useNow';
import { colors, spacing } from '@/theme/tokens';

function addCard() {
  router.push({ pathname: '/cards/add', params: { select: '1' } });
}

function CardPicker() {
  const { user } = useCustomer();
  const checkout = useCheckout(user.uid);
  const draft = useCheckoutDraft();
  const config = useConfig();
  const now = useNow(60_000);

  const header = <Header title="Payment card" />;
  if (checkout.loading && checkout.cards.length === 0) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={2} label="Loading your cards" />
      </Screen>
    );
  }
  if (checkout.error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your cards" error={checkout.error} onRetry={checkout.retry} />
      </Screen>
    );
  }
  return (
    <Screen header={header}>
      {draft.declinedCardId ? (
        <Notice
          tone="danger"
          title="Card declined"
          message="Choose another card or add a new one. Nothing was charged."
        />
      ) : null}
      {config?.paymentsMode === 'test' ? <TestModeNotice /> : null}
      {checkout.cards.length === 0 ? (
        <Text color="muted">Add a card to pay for this order.</Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.list}>
          {checkout.cards.map((card) => {
            const expired = !isFutureExpiry(card.expMonth, card.expYear, now);
            const declined = draft.declinedCardId === card.id;
            return (
              <OptionRow
                key={card.id}
                title={`${CARD_BRAND_LABEL[card.brand]} •••• ${card.last4}`}
                subtitle={`${card.holder} · expires ${expiryLabel(card.expMonth, card.expYear)}`}
                detail={
                  expired
                    ? 'Expired'
                    : declined
                      ? 'Declined on the last try'
                      : card.isDefault
                        ? 'Default card'
                        : null
                }
                leading={
                  <View style={styles.brand}>
                    <CardBrandMark brand={card.brand} tone="dark" scale={0.6} />
                  </View>
                }
                disabled={expired}
                selected={checkout.card?.id === card.id}
                onPress={() => {
                  updateCheckoutDraft({
                    cardId: card.id,
                    declinedCardId: declined ? draft.declinedCardId : null,
                  });
                  router.back();
                }}
              />
            );
          })}
        </View>
      )}
      <AddOptionButton label="Add a card" caption="Visa, Mastercard, Amex or Discover" onPress={addCard} />
    </Screen>
  );
}

/** Choose or add the card for this order (MARKETPLACE §7.3 checkout/card). */
export default function CheckoutCardScreen() {
  return (
    <RequireAccount title="Payment card">
      <CardPicker />
    </RequireAccount>
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
  list: { gap: spacing.sm },
});
