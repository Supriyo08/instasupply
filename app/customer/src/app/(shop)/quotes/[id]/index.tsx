import { describeError } from '@instasupply/api-client';
import type { Quote } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Input,
  Notice,
  Screen,
  Sheet,
  StatusPill,
  Text,
} from '@/components/ui';
import { useToast } from '@/features/notifications/ToastProvider';
import { OrderDetailSkeleton } from '@/features/orders/components/Skeletons';
import { Timeline } from '@/features/orders/components/Timeline';
import { firstParam } from '@/features/orders/params';
import { QuoteOffer } from '@/features/quotes/components/QuoteOffer';
import { QuoteRequestCard } from '@/features/quotes/components/QuoteRequestCard';
import { closeQuote, reopenQuote, useQuote } from '@/features/quotes/hooks';
import {
  QUOTE_STATUS,
  quoteStatusOf,
  quoteTimeline,
  respondByText,
  validityText,
} from '@/features/quotes/quote-format';
import { RequireAccount } from '@/features/session/RequireAccount';
import { supportHref } from '@/features/support/links';
import { useNow } from '@/hooks/useNow';
import { confirmAction, notify } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

/** A material list and its quote 🔒 (MARKETPLACE §7.3 quotes/[id]; CLIENTS §4.3). */
export default function QuoteScreen() {
  return (
    <RequireAccount title="Quote">
      <QuoteBody />
    </RequireAccount>
  );
}

function QuoteBody() {
  const quoteId = firstParam(useLocalSearchParams<{ id: string }>().id);
  const quote = useQuote(quoteId);
  const now = useNow(15_000);
  const data = quote.data;
  const header = <Header title={data?.number ?? 'Quote'} />;

  if (quote.loading && !data) {
    return (
      <Screen header={header}>
        <OrderDetailSkeleton />
      </Screen>
    );
  }
  if (quote.error && !data) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load this quote" error={quote.error} onRetry={quote.retry} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-material-list"
          title="Quote not found"
          message="Your material lists and quotes are under Orders › Quotes."
          action={<Button label="See my quotes" onPress={() => router.navigate('/quotes')} />}
        />
      </Screen>
    );
  }
  return (
    <QuoteDetail quote={data} now={now} header={header} refresh={quote.retry} refreshing={quote.refreshing} />
  );
}

function QuoteDetail({
  quote,
  now,
  header,
  refresh,
  refreshing,
}: {
  quote: Quote;
  now: number;
  header: ReactNode;
  refresh: () => void;
  refreshing: boolean;
}) {
  const toast = useToast();
  const [reopening, setReopening] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'decline' | 'reopen' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = quoteStatusOf(quote, now);
  const meta = QUOTE_STATUS[status];
  const open = status === 'quoted';
  const canDecline = status === 'submitted' || status === 'in_review' || status === 'quoted';
  const canReopen = status === 'quoted' || status === 'expired';
  const note = respondByText(quote, now) ?? (open ? validityText(quote.offerValidUntil, now) : null);

  const decline = async () => {
    const sure = await confirmAction(
      'Decline this quote?',
      status === 'quoted'
        ? `${quote.number} will be closed. You can send a new list any time.`
        : `We'll stop pricing ${quote.number}.`,
      'Decline',
    );
    if (!sure) return;
    setBusy('decline');
    try {
      await closeQuote({ quoteId: quote.id, reason: 'Declined by the customer' });
      toast({ title: `${quote.number} declined`, icon: 'x-circle' });
    } catch (cause) {
      notify("Couldn't decline the quote", describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  const reopen = async () => {
    setBusy('reopen');
    setError(null);
    try {
      await reopenQuote({ quoteId: quote.id, message: message.trim() || null });
      setReopening(false);
      setMessage('');
      toast({ title: 'Sent to our team', body: "We'll send you an updated quote.", icon: 'send' });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen header={header} refreshing={refreshing} onRefresh={refresh}>
      <Card style={styles.card}>
        <StatusPill label={meta.label} tone={meta.tone} />
        {note ? (
          <Text
            variant="captionMedium"
            color={open ? 'primaryDark' : 'muted'}
            accessibilityLiveRegion="polite"
          >
            {note}
          </Text>
        ) : null}
        <Timeline steps={quoteTimeline(quote, now)} now={now} />
      </Card>

      {quote.offer && (status === 'quoted' || status === 'expired' || status === 'accepted') ? (
        <QuoteOffer offer={quote.offer} />
      ) : null}
      {status === 'expired' ? (
        <Notice
          tone="warning"
          title="This quote has expired"
          message="Prices and stock can change. Ask for a fresh quote and we'll price it again."
        />
      ) : null}
      {quote.closeReason && status === 'cancelled' ? (
        <Notice tone="info" message={quote.closeReason} />
      ) : null}

      <QuoteRequestCard quote={quote} now={now} />

      <View style={styles.actions}>
        {open ? (
          <Button
            label="Accept & pay"
            icon="check"
            onPress={() => router.push(`/quotes/${quote.id}/accept`)}
          />
        ) : null}
        {status === 'accepted' && quote.orderId ? (
          <Button label="View the order" onPress={() => router.push(`/orders/${quote.orderId}`)} />
        ) : null}
        {canReopen ? (
          <Button
            label={status === 'expired' ? 'Get a fresh quote' : 'Request changes'}
            icon="edit-3"
            variant="secondary"
            onPress={() => setReopening(true)}
          />
        ) : null}
        <Button
          label="Ask a question"
          icon="message-circle"
          variant="secondary"
          onPress={() =>
            router.push(supportHref({ kind: 'quote', id: quote.id, label: `About ${quote.number}` }))
          }
        />
        {canDecline ? (
          <Button
            label="Decline"
            variant="danger"
            loading={busy === 'decline'}
            onPress={() => void decline()}
          />
        ) : null}
      </View>

      <Sheet
        visible={reopening}
        onClose={() => (busy ? undefined : setReopening(false))}
        title={status === 'expired' ? 'Get a fresh quote' : 'Request changes'}
      >
        <Text color="muted">
          {status === 'expired'
            ? "We'll price your list again with today's stock."
            : 'Tell us what to change: quantities, brands, a different store or delivery time.'}
        </Text>
        <Input
          multiline
          tone="muted"
          placeholder="e.g. Swap to 5/8 in drywall, 30 sheets"
          value={message}
          onChangeText={setMessage}
          maxLength={1000}
          accessibilityLabel="What should we change?"
        />
        {error ? <Notice tone="danger" message={error} /> : null}
        <Button label="Send to InstaSupply" loading={busy === 'reopen'} onPress={() => void reopen()} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  card: { gap: spacing.sm + 2 },
});
