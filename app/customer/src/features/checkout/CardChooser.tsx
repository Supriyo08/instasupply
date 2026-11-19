import { describeError } from '@instasupply/expo-firebase';
import type { SavedCard } from '@instasupply/shared';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, Notice, Skeleton, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { CARD_HEIGHT, CARD_WIDTH, CardOption } from './CardOption';

function AddCardTile({ onPress, wide }: { onPress: () => void; wide: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a new card"
      onPress={onPress}
      style={({ pressed }) => [
        styles.addTile,
        wide ? styles.addTileWide : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.plus}>
        <Icon name="plus" size={20} color={colors.primary} />
      </View>
      <Text variant="bodyMedium" color="primary">
        Add card
      </Text>
      {wide ? (
        <Text variant="caption" color="muted" align="center">
          Save a card to pay online
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Saved cards as swipeable mini green cards, an "Add card" tile and the test-mode note. */
export function CardChooser({
  cards,
  loading,
  error,
  selectedId,
  onSelect,
  onAdd,
  onRetry,
}: {
  cards: SavedCard[];
  loading: boolean;
  error: Error | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** Loads the saved cards again after `error` (the `retry` of `useCards`). */
  onRetry?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      {loading && cards.length === 0 ? (
        <View accessible accessibilityLabel="Loading your saved cards" style={styles.skeletonRow}>
          <Skeleton style={styles.skeleton} />
        </View>
      ) : error ? (
        <Notice
          tone="danger"
          title="Couldn't load your saved cards"
          message={describeError(error, 'Check your connection, or pay with cash on delivery.')}
          actionLabel="Try again"
          onAction={onRetry}
        />
      ) : cards.length === 0 ? (
        <AddCardTile onPress={onAdd} wide />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel="Saved cards"
          style={styles.scroller}
          contentContainerStyle={styles.cards}
        >
          {cards.map((card) => (
            <CardOption key={card.id} card={card} selected={card.id === selectedId} onSelect={onSelect} />
          ))}
          <AddCardTile onPress={onAdd} wide={false} />
        </ScrollView>
      )}
      <Notice
        tone="info"
        icon="shield"
        message="Test mode — no money is charged. We only keep the card brand, last 4 digits and expiry."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  addTile: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.primaryLight,
    borderRadius: radius.lg,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    gap: 6,
    height: CARD_HEIGHT,
    justifyContent: 'center',
    width: 120,
  },
  addTileWide: { alignSelf: 'stretch', height: 120, width: 'auto' },
  cards: { alignItems: 'center', gap: 12, paddingHorizontal: spacing.gutter },
  plus: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  // Let the carousel run edge to edge while the first card lines up with the page gutter.
  scroller: { marginHorizontal: -spacing.gutter },
  skeleton: { borderRadius: radius.lg, height: CARD_HEIGHT, width: CARD_WIDTH },
  skeletonRow: { flexDirection: 'row' },
  wrap: { gap: 12 },
});
