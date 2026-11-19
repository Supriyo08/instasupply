import { describeError } from '@instasupply/expo-firebase';
import type { SavedCard } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorState, Header, IconButton, Notice, Screen, Skeleton } from '@/components/ui';
import { removeCard } from '@/features/account/card/card-actions';
import { CARD_BRAND_LABEL } from '@/features/account/card/card-format';
import { CardsEmpty } from '@/features/account/card/CardsEmpty';
import { SavedCardItem, type CardBusy } from '@/features/account/card/SavedCardItem';
import { setDefaultCard, useCards } from '@/features/cards/hooks';
import { useToast } from '@/features/notifications/ToastProvider';
import { useCustomer } from '@/features/session/SessionProvider';
import { confirmAction, notify } from '@/lib/notify';
import { radius } from '@/theme/tokens';

const addCard = () => router.push('/cards/add');

/** "My Cards": saved cards as green card art, default first; set default or remove. */
export default function CardsScreen() {
  const { user } = useCustomer();
  const toast = useToast();
  const cards = useCards(user.uid);
  const [busy, setBusy] = useState<{ id: string; action: NonNullable<CardBusy> } | null>(null);
  // Default card first, then in the order they were added.
  const list = [...cards.data].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  const makeDefault = async (card: SavedCard) => {
    setBusy({ id: card.id, action: 'default' });
    try {
      await setDefaultCard(user.uid, card.id, cards.data);
      toast({
        title: 'Default card updated',
        body: `${CARD_BRAND_LABEL[card.brand]} •••• ${card.last4}`,
        icon: 'credit-card',
      });
    } catch (error) {
      notify("Couldn't update your default card", describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (card: SavedCard) => {
    const confirmed = await confirmAction(
      'Remove this card?',
      `${CARD_BRAND_LABEL[card.brand]} ending ${card.last4} will be removed from your saved cards.`,
      'Remove',
    );
    if (!confirmed) return;
    setBusy({ id: card.id, action: 'delete' });
    try {
      await removeCard(user.uid, card, cards.data);
      toast({ title: 'Card removed', icon: 'trash-2' });
    } catch (error) {
      notify("Couldn't remove the card", describeError(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      header={
        <Header
          title="My Cards"
          right={<IconButton icon="plus-circle" label="Add card" onPress={addCard} />}
        />
      }
      footer={<Button label="Add card" icon="plus" onPress={addCard} />}
    >
      <Notice
        tone="info"
        icon="shield"
        title="Test mode"
        message="Card payments run in test mode, so no real money is charged. We only keep each card's brand, last 4 digits and expiry."
      />
      {cards.loading ? (
        <View style={styles.list} accessibilityLabel="Loading cards">
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonBar} />
        </View>
      ) : cards.error ? (
        <ErrorState title="Couldn't load your cards" error={cards.error} onRetry={cards.retry} />
      ) : list.length === 0 ? (
        <CardsEmpty onAdd={addCard} />
      ) : (
        <View style={styles.list}>
          {list.map((card) => (
            <SavedCardItem
              key={card.id}
              card={card}
              busy={busy?.id === card.id ? busy.action : null}
              onMakeDefault={() => void makeDefault(card)}
              onDelete={() => void remove(card)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 22 },
  skeletonBar: { alignSelf: 'center', height: 54, maxWidth: 420, width: '100%' },
  skeletonCard: {
    alignSelf: 'center',
    aspectRatio: 1.8,
    borderRadius: radius.lg,
    maxWidth: 420,
    width: '100%',
  },
});
