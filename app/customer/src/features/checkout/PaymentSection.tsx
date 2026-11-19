import { formatCurrency, type PaymentMethod, type SavedCard } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Notice, Text } from '@/components/ui';

import { CardChooser } from './CardChooser';
import { PaymentMethodTiles } from './PaymentMethodTiles';

/** "Payment method" block: method tiles, then the cash note or the saved-card chooser. */
export function PaymentSection({
  method,
  onMethodChange,
  total,
  cards,
  cardsLoading,
  cardsError,
  selectedCardId,
  onSelectCard,
  onAddCard,
  onRetryCards,
}: {
  method: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
  total: number | null;
  cards: SavedCard[];
  cardsLoading: boolean;
  cardsError: Error | null;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onAddCard: () => void;
  /** Loads the saved cards again after `cardsError`. */
  onRetryCards?: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text variant="heading">Payment method</Text>
      <PaymentMethodTiles value={method} onChange={onMethodChange} />
      {method === 'cod' ? (
        <Notice
          tone="success"
          icon="info"
          message={
            total != null
              ? `Pay ${formatCurrency(total)} to the driver when your order arrives.`
              : 'Pay the driver when your order arrives.'
          }
        />
      ) : (
        <CardChooser
          cards={cards}
          loading={cardsLoading}
          error={cardsError}
          selectedId={selectedCardId}
          onSelect={onSelectCard}
          onAdd={onAddCard}
          onRetry={onRetryCards}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
});
