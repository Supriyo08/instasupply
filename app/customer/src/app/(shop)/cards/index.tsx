import { useConfig } from '@instasupply/api-client/react';
import type { SavedCard } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, ErrorState, Header, IconButton, Notice, Screen } from '@/components/ui';
import { CARD_BRAND_LABEL } from '@/features/account/card/card-format';
import { SavedCardItem, type CardBusy } from '@/features/account/card/SavedCardItem';
import { deleteCard, setDefaultCard, useCards } from '@/features/cards/hooks';
import { AcceptedCards, TestModeNotice } from '@/features/cards/TestModeNotice';
import { AddOptionButton } from '@/features/checkout/AddOptionButton';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { useToast } from '@/features/notifications/ToastProvider';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { describeError } from '@/lib/api';
import { confirmAction } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

function addCard() {
  router.push('/cards/add');
}

function Cards() {
  const { user } = useCustomer();
  const cards = useCards(user.uid);
  const config = useConfig();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; kind: CardBusy } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const disabled = config?.paymentsMode === 'disabled';

  const makeDefault = async (card: SavedCard) => {
    setBusy({ id: card.id, kind: 'default' });
    setFailure(null);
    try {
      await setDefaultCard(card);
    } catch (error) {
      setFailure(describeError(error, "Couldn't change the default card. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (card: SavedCard) => {
    const name = `${CARD_BRAND_LABEL[card.brand]} ending ${card.last4}`;
    const confirmed = await confirmAction(
      `Remove ${name}?`,
      'Orders already placed with it are not affected.',
      'Remove',
    );
    if (!confirmed) return;
    setBusy({ id: card.id, kind: 'delete' });
    setFailure(null);
    try {
      // The server moves the default flag to another card when the default is removed.
      await deleteCard(card.id);
      toast({ title: 'Card removed', body: name, icon: 'trash-2' });
    } catch (error) {
      setFailure(describeError(error, "Couldn't remove the card. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <Header
      title="Payment cards"
      right={disabled ? null : <IconButton icon="plus" label="Add a card" onPress={addCard} />}
    />
  );
  if (cards.loading && cards.data.length === 0) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={2} label="Loading your cards" />
      </Screen>
    );
  }
  if (cards.error && cards.data.length === 0) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your cards" error={cards.error} onRetry={cards.retry} />
      </Screen>
    );
  }

  const banner =
    config?.paymentsMode === 'test' ? (
      <TestModeNotice />
    ) : disabled ? (
      <Notice
        tone="warning"
        title="Card payments aren't available yet"
        message="You can still send us your material list for a quote."
      />
    ) : null;

  if (cards.data.length === 0) {
    return (
      <Screen header={header}>
        {banner}
        <EmptyState
          art="scene-order-confirmed"
          title="No saved cards yet"
          message="Save a card once and pay in a tap at checkout. It's only charged when your order is complete."
          action={disabled ? undefined : <Button label="Add a card" icon="plus" onPress={addCard} />}
        />
        <AcceptedCards />
      </Screen>
    );
  }
  return (
    <Screen header={header} refreshing={cards.refreshing} onRefresh={cards.retry}>
      {banner}
      {failure ? <Notice tone="danger" message={failure} /> : null}
      <View style={styles.list}>
        {cards.data.map((card) => (
          <SavedCardItem
            key={card.id}
            card={card}
            busy={busy?.id === card.id ? busy.kind : null}
            onMakeDefault={() => void makeDefault(card)}
            onDelete={() => void remove(card)}
          />
        ))}
      </View>
      {disabled ? null : (
        <AddOptionButton label="Add a card" caption="Visa, Mastercard, Amex or Discover" onPress={addCard} />
      )}
      <AcceptedCards />
    </Screen>
  );
}

/** Saved payment cards (MARKETPLACE §7.3 cards/index): default, remove, test-mode banner. */
export default function CardsScreen() {
  return (
    <RequireAccount title="Payment cards">
      <Cards />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xl },
});
