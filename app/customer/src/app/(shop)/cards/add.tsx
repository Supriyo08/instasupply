import { describeError } from '@instasupply/expo-firebase';
import { detectCardBrand } from '@instasupply/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button, Header, Notice, Screen } from '@/components/ui';
import { isDuplicateCard } from '@/features/account/card/card-actions';
import { CARD_BRAND_LABEL, digitsOnly, previewCardNumber } from '@/features/account/card/card-format';
import { CardInputs, type CardDraft } from '@/features/account/card/CardInputs';
import { CardVisual } from '@/features/account/card/CardVisual';
import { leaveTo } from '@/features/account/format';
import { SwitchRow } from '@/features/account/SwitchRow';
import { addCard, useCards, validateCard, type CardErrors } from '@/features/cards/hooks';
import { useToast } from '@/features/notifications/ToastProvider';
import { useCustomer } from '@/features/session/SessionProvider';
import { notify } from '@/lib/notify';

const EMPTY: CardDraft = { holder: '', number: '', expiry: '', cvv: '' };

/** "Add Credit Card": live card preview, card fields and the default switch (test-mode payments). */
export default function AddCardScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useCustomer();
  const cards = useCards(user.uid);
  const toast = useToast();
  const [draft, setDraft] = useState<CardDraft>(EMPTY);
  const [errors, setErrors] = useState<CardErrors>({});
  const [makeDefault, setMakeDefault] = useState(true);
  const [cvvFocused, setCvvFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  const brand = detectCardBrand(draft.number);
  const last4 = digitsOnly(draft.number).slice(-4);
  const first = !cards.loading && cards.data.length === 0;

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
    const found = validateCard(input);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const [month = 0, year = 0] = draft.expiry.split('/').map(Number);
    if (isDuplicateCard(cards.data, { brand, last4, expMonth: month, expYear: year })) {
      notify('Card already saved', `${CARD_BRAND_LABEL[brand]} ending ${last4} is already in your cards.`);
      return;
    }
    setSaving(true);
    try {
      await addCard(user.uid, input, cards.data);
      setDraft((current) => ({ ...current, cvv: '' }));
      toast({
        title: 'Card added',
        body: `${CARD_BRAND_LABEL[brand]} •••• ${last4} is ready for checkout.`,
        icon: 'credit-card',
      });
      leaveTo(returnTo === 'checkout' ? '/checkout/payment' : '/cards');
    } catch (error) {
      notify("Couldn't add the card", describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={<Header title="Add Credit Card" />}
      footer={
        <Button
          label="Add credit card"
          loading={saving}
          // addCard needs the saved cards to keep exactly one default.
          disabled={cards.loading || !!cards.error}
          onPress={() => void submit()}
        />
      }
    >
      {cards.error ? (
        <Notice
          tone="danger"
          title="Couldn't load your saved cards"
          message={describeError(cards.error, 'Check your connection and try again.')}
          actionLabel="Try again"
          onAction={cards.retry}
        />
      ) : null}
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
      <CardInputs draft={draft} errors={errors} onChange={change} onCvvFocusChange={setCvvFocused} />
      <SwitchRow
        label="Save as default card"
        hint={first ? 'Your first card becomes your default.' : 'Pre-select this card at checkout.'}
        value={makeDefault || first}
        locked={first || saving}
        onChange={setMakeDefault}
      />
      <Notice
        tone="info"
        icon="lock"
        title="Only the last 4 digits are stored"
        message="We keep the card brand, last 4 digits and expiry. Your full number and CVV never leave this screen. Payments run in test mode: try 4242 4242 4242 4242 with any future date."
      />
    </Screen>
  );
}
