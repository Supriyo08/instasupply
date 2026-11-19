import { detectCardBrand } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Input } from '@/components/ui';
import type { CardErrors } from '@/features/cards/hooks';

import { cardNumberMaxLength, digitsOnly, formatCardNumber, formatExpiryInput } from './card-format';
import { CardBrandMark } from './CardBrandMark';

/** Raw form values; the CVV only lives here and is never sent anywhere. */
export interface CardDraft {
  holder: string;
  number: string;
  expiry: string;
  cvv: string;
}

/** "Add Credit Card" fields: name, auto-formatted number with brand mark, MM/YY and CVV. */
export function CardInputs({
  draft,
  errors,
  onChange,
  onCvvFocusChange,
}: {
  draft: CardDraft;
  errors: CardErrors;
  onChange: (patch: Partial<CardDraft>) => void;
  onCvvFocusChange: (focused: boolean) => void;
}) {
  const brand = detectCardBrand(draft.number);
  return (
    <View style={styles.fields}>
      <Input
        icon="user"
        placeholder="Name on the card"
        value={draft.holder}
        error={errors.holder}
        maxLength={80}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="cc-name"
        textContentType="creditCardName"
        onChangeText={(holder) => onChange({ holder })}
      />
      <Input
        icon="credit-card"
        placeholder="Card number"
        value={draft.number}
        error={errors.number}
        maxLength={cardNumberMaxLength(brand)}
        keyboardType="number-pad"
        autoComplete="cc-number"
        textContentType="creditCardNumber"
        onChangeText={(value) => onChange({ number: formatCardNumber(value) })}
        trailing={brand !== 'card' ? <CardBrandMark brand={brand} tone="dark" scale={0.7} /> : null}
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <Input
            icon="calendar"
            placeholder="Month / Year"
            value={draft.expiry}
            error={errors.expiry}
            style={styles.shrink}
            maxLength={5}
            keyboardType="number-pad"
            autoComplete="cc-exp"
            textContentType="creditCardExpiration"
            onChangeText={(value) => onChange({ expiry: formatExpiryInput(value, draft.expiry) })}
          />
        </View>
        <View style={styles.half}>
          <Input
            icon="lock"
            placeholder="CVV"
            value={draft.cvv}
            error={errors.cvv}
            style={styles.shrink}
            maxLength={4}
            keyboardType="number-pad"
            secureTextEntry
            autoComplete="cc-csc"
            textContentType="creditCardSecurityCode"
            onChangeText={(value) => onChange({ cvv: digitsOnly(value).slice(0, 4) })}
            onFocus={() => onCvvFocusChange(true)}
            onBlur={() => onCvvFocusChange(false)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 10 },
  half: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  // On the web an <input> keeps its intrinsic width in a flex row; let half-width fields shrink.
  shrink: { minWidth: 0 },
});
