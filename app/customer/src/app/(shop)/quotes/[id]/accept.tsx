import { describeError, detailsFor, errorCodeOf } from '@instasupply/api-client';
import { useConfig } from '@instasupply/api-client/react';
import {
  asapWindow,
  formatMoney,
  isQuoteOfferExpired,
  scheduledWindows,
  type Quote,
  type QuoteOffer,
  type Receiving,
  type WindowOption,
  type WindowStoreInput,
} from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, EmptyState, ErrorState, Header, Input, Notice, Screen, Text } from '@/components/ui';
import { FormSection } from '@/features/account/FormSection';
import { SwitchRow } from '@/features/account/SwitchRow';
import { CARD_BRAND_LABEL } from '@/features/account/card/card-format';
import { useCards } from '@/features/cards/hooks';
import { OrderDetailSkeleton } from '@/features/orders/components/Skeletons';
import { firstParam } from '@/features/orders/params';
import { WindowChooser } from '@/features/quotes/components/WindowChooser';
import { acceptQuote, useQuote } from '@/features/quotes/hooks';
import { validityText } from '@/features/quotes/quote-format';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useStores } from '@/features/stores/hooks';
import { useNow } from '@/hooks/useNow';
import { newRequestId } from '@/lib/ids';
import { spacing } from '@/theme/tokens';

/** Accept & pay a quote 🔒 (MARKETPLACE §7.3 quotes/[id]/accept; CLIENTS §4.3). */
export default function AcceptQuoteScreen() {
  return (
    <RequireAccount title="Accept quote">
      <AcceptBody />
    </RequireAccount>
  );
}

function AcceptBody() {
  const quoteId = firstParam(useLocalSearchParams<{ id: string }>().id);
  const quote = useQuote(quoteId);
  const now = useNow(15_000);
  const header = <Header title="Accept quote" />;
  if (quote.loading && !quote.data) {
    return (
      <Screen header={header}>
        <OrderDetailSkeleton />
      </Screen>
    );
  }
  if (quote.error && !quote.data) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load the quote" error={quote.error} onRetry={quote.retry} />
      </Screen>
    );
  }
  const data = quote.data;
  if (!data?.offer || data.status !== 'quoted' || isQuoteOfferExpired(data, now)) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-material-list"
          title={data?.status === 'accepted' ? 'Already accepted' : 'This quote can no longer be accepted'}
          message={
            data?.status === 'accepted'
              ? 'Your order is on its way through the stores.'
              : 'It has expired or changed. Open the quote to ask for a fresh one.'
          }
          action={
            data ? (
              <Button label="Open the quote" onPress={() => router.replace(`/quotes/${data.id}`)} />
            ) : undefined
          }
        />
      </Screen>
    );
  }
  return <AcceptForm quote={data} offer={data.offer} now={now} reload={quote.retry} />;
}

const RECEIVING: { value: Receiving; label: string; hint: string }[] = [
  { value: 'attended', label: 'Someone on site', hint: 'They get a 4-digit code for the driver' },
  { value: 'unattended', label: 'Leave at site', hint: 'The driver takes a photo on drop' },
];

function AcceptForm({
  quote,
  offer,
  now,
  reload,
}: {
  quote: Quote;
  offer: QuoteOffer;
  now: number;
  reload: () => void;
}) {
  const { user } = useCustomer();
  const delivery = offer.fulfilment === 'delivery';
  const cards = useCards(user.uid);
  const stores = useStores();
  const config = useConfig();
  const jobsite = quote.request.jobsite;
  // One id per screen, kept across retries: a retry after a lost answer returns the same order.
  const [checkoutId] = useState(() => newRequestId());
  const [cardId, setCardId] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<Receiving>(offer.receiving ?? jobsite?.receiving ?? 'attended');
  const [instructions, setInstructions] = useState(jobsite?.instructions ?? '');
  const [unload, setUnload] = useState<string[]>(offer.unloadHelpStoreIds);
  const [expected, setExpected] = useState(offer.pricing.totalCents);
  const [serverWindows, setServerWindows] = useState<WindowOption[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const card = cards.data.find((entry) => entry.id === cardId) ?? cards.defaultCard;
  const windows = useMemo((): WindowOption[] => {
    if (!delivery) return [];
    if (serverWindows) return serverWindows;
    const inputs = offer.pricing.stores.flatMap((priced): WindowStoreInput[] => {
      const store = stores.data.find((entry) => entry.id === priced.storeId);
      return store && priced.vehicleClass && priced.roadTenths != null
        ? [
            {
              storeId: priced.storeId,
              store,
              vehicleClass: priced.vehicleClass,
              roadTenths: priced.roadTenths,
            },
          ]
        : [];
    });
    if (inputs.length !== offer.pricing.stores.length) return [];
    return [asapWindow(inputs, now), ...scheduledWindows(inputs, now)];
  }, [delivery, now, offer.pricing.stores, serverWindows, stores.data]);
  const quoted = windows.find((window) => window.id === offer.windowId);
  const quotedValid = offer.windowId != null && (windows.length === 0 || quoted?.available === true);
  // Null sends "the window of the offer"; otherwise the customer's pick.
  const chosenWindow =
    windowId ?? (quotedValid ? null : (windows.find((window) => window.available)?.id ?? null));

  const submit = async () => {
    if (!card) return setNotice({ tone: 'warning', message: 'Add a card to pay with.' });
    setBusy(true);
    setNotice(null);
    try {
      const result = await acceptQuote({
        quoteId: quote.id,
        version: offer.version,
        checkoutId,
        cardId: card.id,
        windowId: delivery ? chosenWindow : null,
        receiving: delivery ? receiving : null,
        siteContact: jobsite ? { name: jobsite.contactName, phone: jobsite.contactPhone } : null,
        instructions: instructions.trim() || null,
        unloadHelpStoreIds: unload,
        expectedTotalCents: expected,
      });
      router.replace({
        pathname: '/order-success',
        params: { orderId: result.orderId, number: result.number, total: String(result.totalCents) },
      });
    } catch (error) {
      const code = errorCodeOf(error);
      const changed = detailsFor(error, 'PRICE_CHANGED');
      const fresh = detailsFor(error, 'WINDOW_UNAVAILABLE');
      if (changed) {
        setExpected(changed.pricing.totalCents);
        setNotice({
          tone: 'warning',
          message: `The total is now ${formatMoney(changed.pricing.totalCents)}. Tap Accept & pay again to confirm.`,
        });
      } else if (fresh) {
        setServerWindows(fresh.windows);
        setWindowId(null);
        setNotice({
          tone: 'warning',
          message: 'That delivery time is no longer available. Choose another one.',
        });
      } else if (code === 'QUOTE_EXPIRED' || code === 'QUOTE_VERSION') {
        reload();
        setNotice({
          tone: 'warning',
          message:
            code === 'QUOTE_EXPIRED'
              ? 'This quote has just expired. Ask for a fresh quote.'
              : 'We have just updated this quote. Check the new offer.',
        });
      } else if (code === 'PHONE_UNVERIFIED') {
        router.push('/verify-phone');
      } else if (code === 'CARD_DECLINED') {
        setNotice({
          tone: 'danger',
          message: 'That card was declined. Choose another card or add a new one.',
        });
      } else {
        setNotice({ tone: 'danger', message: describeError(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title="Accept quote" />}
      footer={
        <Button
          label={`Accept & pay · ${formatMoney(expected)}`}
          loading={busy}
          disabled={cards.loading && !card}
          onPress={() => void submit()}
        />
      }
    >
      <View style={styles.intro}>
        <Text variant="title">{quote.number}</Text>
        <Text variant="captionMedium" color="primaryDark">
          {validityText(quote.offerValidUntil, now)}
        </Text>
      </View>
      <FormSection
        title="Pay with"
        subtitle="Your card is held now and charged when the stores finish your order."
      >
        {config?.paymentsMode === 'test' ? (
          <Notice tone="info" icon="shield" message="Test mode: no real charge is made." />
        ) : null}
        <View style={styles.chips}>
          {cards.data.map((entry) => (
            <Chip
              key={entry.id}
              icon="credit-card"
              label={`${CARD_BRAND_LABEL[entry.brand]} ••${entry.last4}`}
              selected={card?.id === entry.id}
              onPress={() => setCardId(entry.id)}
            />
          ))}
          <Chip icon="plus" label="Add a card" onPress={() => router.push('/cards/add')} />
        </View>
      </FormSection>
      {delivery ? (
        <>
          <FormSection
            title="Delivery options"
            subtitle={jobsite ? `${jobsite.label} · ${jobsite.addressLine}` : undefined}
          >
            {offer.windowLabel && quotedValid ? (
              <Chip
                label={`As quoted: ${offer.windowLabel}`}
                icon="calendar"
                selected={windowId === null}
                onPress={() => setWindowId(null)}
              />
            ) : offer.windowLabel ? (
              <Text variant="caption" color="muted">
                The quoted time ({offer.windowLabel}) is no longer available.
              </Text>
            ) : null}
            {windows.length > 0 ? (
              <WindowChooser
                windows={windows}
                value={windowId ?? (quotedValid ? null : chosenWindow)}
                onChange={setWindowId}
                now={now}
              />
            ) : null}
          </FormSection>
          <FormSection title="Receiving">
            <View style={styles.chips}>
              {RECEIVING.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  accessibilityLabel={`${option.label}: ${option.hint}`}
                  selected={receiving === option.value}
                  onPress={() => setReceiving(option.value)}
                />
              ))}
            </View>
            <Text variant="caption" color="muted">
              {RECEIVING.find((option) => option.value === receiving)?.hint}
            </Text>
            <Input
              multiline
              tone="default"
              placeholder="Add delivery instructions (gate code, where to stack)"
              value={instructions}
              onChangeText={setInstructions}
              maxLength={500}
              accessibilityLabel="Delivery instructions"
            />
          </FormSection>
          {offer.pricing.stores.some((priced) => priced.unload.offered) ? (
            <FormSection
              title="Need help unloading? Add a labourer"
              subtitle="Changing this changes the total; we'll show it before you pay."
            >
              {offer.pricing.stores
                .filter((priced) => priced.unload.offered)
                .map((priced) => {
                  const name =
                    offer.lines.find((line) => line.storeId === priced.storeId)?.storeName ?? priced.letter;
                  const on = priced.unload.required || unload.includes(priced.storeId);
                  return (
                    <SwitchRow
                      key={priced.storeId}
                      label={name}
                      hint={
                        priced.unload.required
                          ? 'Required for a heavy load left at an unattended site'
                          : on && priced.unload.feeCents > 0
                            ? formatMoney(priced.unload.feeCents)
                            : 'A labourer comes with the driver'
                      }
                      value={on}
                      locked={priced.unload.required}
                      onChange={(value) =>
                        setUnload((current) =>
                          value
                            ? [...current, priced.storeId]
                            : current.filter((id) => id !== priced.storeId),
                        )
                      }
                    />
                  );
                })}
            </FormSection>
          ) : null}
        </>
      ) : (
        <Notice
          tone="info"
          icon="shopping-bag"
          message="Pickup: each store gives you a PIN to show at the counter once your order is ready."
        />
      )}
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  intro: { gap: spacing.xs },
});
