import { useConfig } from '@instasupply/api-client/react';
import { detectCardBrand } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Header, Notice, Screen, Text, Toggle } from '@/components/ui';
import { isDuplicateCard } from '@/features/account/card/card-actions';
import { CARD_BRAND_LABEL, digitsOnly, previewCardNumber } from '@/features/account/card/card-format';
import { CardInputs, type CardDraft } from '@/features/account/card/CardInputs';
import { CardVisual } from '@/features/account/card/CardVisual';
import { addCard, useCards, validateCard, type CardErrors } from '@/features/cards/hooks';
import { AcceptedCards, TestModeNotice } from '@/features/cards/TestModeNotice';
import { updateCheckoutDraft } from '@/features/checkout/checkout-draft';
import { singleParam } from '@/features/checkout/navigation';
import { useToast } from '@/features/notifications/ToastProvider';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useNow } from '@/hooks/useNow';
import { describeError } from '@/lib/api';
import { spacing } from '@/theme/tokens';

const EMPTY: CardDraft = { holder: '', number: '', expiry: '', cvv: '' };

function AddCard() {
  const params = useLocalSearchParams<{ select?: string }>();
  const select = singleParam(params.select) === '1';
  const { user } = useCustomer();
  const cards = useCards(user.uid);
  const config = useConfig();
  const toast = useToast();
  const now = useNow(60_000);
  const [draft, setDraft] = useState<CardDraft>(EMPTY);
  const [errors, setErrors] = useState<CardErrors>({});
  const [makeDefault, setMakeDefault] = useState(true);
  const [cvvFocused, setCvvFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const brand = detectCardBrand(draft.number);
  const last4 = digitsOnly(draft.number).slice(-4);
  const first = !cards.loading && cards.data.length === 0;
  const disabled = config?.paymentsMode === 'disabled';

  const change = (patch: Partial<CardDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof CardErrors];
      return next;
    });
  };

  const submit = async () => {
    const input = { ...draft, makeDefault: makeDefault || first };
    const found = validateCard(input, now);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    if (brand === 'card') {
      setErrors({ number: 'We take Visa, Mastercard, American Express and Discover.' });
      return;
    }
    const [month = 0, year = 0] = draft.expiry.split('/').map(Number);
    if (isDuplicateCard(cards.data, { brand, last4, expMonth: month, expYear: year })) {
      setFailure(`${CARD_BRAND_LABEL[brand]} ending ${last4} is already in your cards.`);
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const saved = await addCard(input, cards.data);
      setDraft(EMPTY);
      toast({
        title: 'Card added',
        body: `${CARD_BRAND_LABEL[brand]} •••• ${last4} is ready for checkout.`,
        icon: 'credit-card',
      });
      if (select) {
        updateCheckoutDraft({ cardId: saved.id, declinedCardId: null });
        router.dismissTo('/checkout');
      } else {
        router.back();
      }
    } catch (error) {
      setFailure(describeError(error, "Couldn't add the card. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={<Header title="Add a card" />}
      footer={
        <Button
          label="Add card"
          loading={saving}
          // The first card becomes the default, so the saved cards must have loaded.
          disabled={cards.loading || !!cards.error || disabled || saving}
          onPress={() => void submit()}
        />
      }
    >
      {disabled ? (
        <Notice
          tone="warning"
          title="Card payments aren't available yet"
          message="You can add a card once payments open."
        />
      ) : null}
      {cards.error ? (
        <Notice
          tone="danger"
          title="Couldn't load your saved cards"
          message={describeError(cards.error, 'Check your connection and try again.')}
          actionLabel="Try again"
          onAction={cards.retry}
        />
      ) : null}
      {failure ? <Notice tone="danger" message={failure} /> : null}
      <CardVisual
        side={cvvFocused ? 'back' : 'front'}
        cvvLength={draft.cvv.length}
        brand={brand}
        number={previewCardNumber(draft.number)}
        holder={draft.holder.trim() || 'Your name'}
        expiry={draft.expiry + 'MM/YY'.slice(draft.expiry.length)}
        accessibilityLabel={
          last4.length === 4 ? `Card preview, ${CARD_BRAND_LABEL[brand]} ending ${last4}` : 'Card preview'
        }
      />
      <AcceptedCards />
      <CardInputs draft={draft} errors={errors} onChange={change} onCvvFocusChange={setCvvFocused} />
      <Card style={styles.toggle}>
        <View style={styles.flex}>
          <Text variant="bodyMedium">Save as default card</Text>
          <Text variant="caption" color="muted">
            {first ? 'Your first card becomes your default.' : 'Pre-selected at checkout.'}
          </Text>
        </View>
        <Toggle
          label="Save as default card"
          value={makeDefault || first}
          disabled={first || saving}
          onValueChange={setMakeDefault}
        />
      </Card>
      {config?.paymentsMode === 'test' ? <TestModeNotice /> : null}
      <Text variant="caption" color="muted">
        We keep the card brand, last 4 digits and expiry. Your full number and CVV never leave this screen.
      </Text>
    </Screen>
  );
}

/** Add a card (MARKETPLACE §7.3 cards/add): Luhn and expiry checks; only brand, last 4 and expiry are saved. */
export default function AddCardScreen() {
  return (
    <RequireAccount title="Add a card">
      <AddCard />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toggle: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
