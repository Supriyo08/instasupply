import { formatDateTimeET, formatMoney } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TabHeader } from '@/components/TabHeader';
import { Button, Card, Chip, EmptyState, ErrorState, Money, Screen, Skeleton, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { EntryRow, PayoutRow } from '@/features/earnings/EarningsRows';
import { useBalance, useLedger, usePayouts, useUnpaidEntries } from '@/features/earnings/hooks';
import { usePeriodTotals } from '@/features/earnings/periods';
import { useNow } from '@/lib/use-now';
import { useTheme } from '@/theme/ThemeProvider';

type Section = 'unpaid' | 'all' | 'payouts';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'all', label: 'All entries' },
  { id: 'payouts', label: 'Payouts' },
];

/**
 * Earnings (MARKETPLACE §10 `(tabs)/earnings`, §3.9 to §3.10; CLIENTS §4.6): today and this week, the
 * unpaid balance (the server's sum), ledger entries and daily payouts with their references.
 */
export default function EarningsScreen() {
  const { user } = useDriver();
  const now = useNow(60_000);
  const { colors } = useTheme();
  const balance = useBalance(user.uid);
  const ledger = useLedger(user.uid);
  const unpaid = useUnpaidEntries(user.uid);
  const payouts = usePayouts(user.uid);
  const totals = usePeriodTotals(ledger, now);
  const [section, setSection] = useState<Section>('unpaid');

  const list = section === 'payouts' ? payouts : section === 'unpaid' ? unpaid : ledger;
  const refresh = () => {
    balance.retry();
    list.retry();
  };

  return (
    <Screen onRefresh={refresh} refreshing={balance.refreshing}>
      <TabHeader title="Earnings" subtitle="Paid out daily to your bank account" />

      <View style={styles.periods}>
        <PeriodCard label="Today" cents={totals.todayCents} count={totals.todayCount} />
        <PeriodCard
          label="This week"
          cents={totals.weekCents}
          count={totals.weekCount}
          note={totals.incomplete ? 'Latest entries only' : undefined}
        />
      </View>

      <Card accent={colors.primary}>
        {balance.loading ? (
          <Skeleton height={64} />
        ) : balance.error ? (
          <ErrorState error={balance.error} onRetry={balance.retry} title="Couldn't load your balance" />
        ) : (
          <View
            accessible
            accessibilityLabel={`Unpaid balance ${formatMoney(balance.data?.unpaidCents ?? 0)}`}
            style={styles.balance}
          >
            <Text variant="caption" color="muted">
              Unpaid balance
            </Text>
            <Money cents={balance.data?.unpaidCents ?? 0} variant="display" />
            <Text variant="caption" color="subtle">
              {balance.data?.unpaidCount ?? 0} {balance.data?.unpaidCount === 1 ? 'entry' : 'entries'} in the
              next payout
              {balance.data?.lastPaidAt
                ? ` · last paid ${formatDateTimeET(balance.data.lastPaidAt, now)}`
                : ''}
            </Text>
            {balance.data && balance.data.heldCents !== 0 ? (
              <Text variant="caption" color="warning">
                {formatMoney(balance.data.heldCents)} on hold while a customer issue is reviewed
              </Text>
            ) : null}
          </View>
        )}
      </Card>

      <View style={styles.chips}>
        {SECTIONS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={section === option.id}
            onPress={() => setSection(option.id)}
          />
        ))}
      </View>

      <Card>
        {list.loading ? (
          <View style={styles.skeletons} accessibilityLabel="Loading">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </View>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.retry} />
        ) : section === 'payouts' ? (
          payouts.items.length === 0 ? (
            <EmptyState
              icon="cash-outline"
              title="No payouts yet"
              message="Payouts run once a day and add up your unpaid entries. Each one has a reference for your bank."
            />
          ) : (
            payouts.items.map((payout) => <PayoutRow key={payout.id} payout={payout} now={now} />)
          )
        ) : (section === 'unpaid' ? unpaid.items : ledger.items).length === 0 ? (
          <View>
            <SceneArt scene="scene-order-confirmed" height={110} />
            <EmptyState
              icon="wallet-outline"
              title={section === 'unpaid' ? 'Nothing waiting to be paid' : 'No earnings yet'}
              message="Every delivery, failed attempt, cancellation and correction is listed here with its amount."
            />
          </View>
        ) : (
          (section === 'unpaid' ? unpaid.items : ledger.items).map((entry) => (
            <EntryRow key={entry.id} entry={entry} now={now} />
          ))
        )}
        {list.hasMore && !list.loading ? (
          <Button label="Show more" variant="ghost" loading={list.loadingMore} onPress={list.loadMore} />
        ) : null}
      </Card>
    </Screen>
  );
}

function PeriodCard({
  label,
  cents,
  count,
  note,
}: {
  label: string;
  cents: number | null;
  count: number;
  note?: string;
}) {
  return (
    <Card style={styles.period}>
      <View
        accessible
        accessibilityLabel={
          cents == null ? `${label}: loading` : `${label}: ${formatMoney(cents)}, ${count} entries`
        }
      >
        <Text variant="caption" color="muted">
          {label}
        </Text>
        {cents == null ? <Skeleton width={90} height={28} /> : <Money cents={cents} variant="title" />}
        <Text variant="caption" color="subtle">
          {note ?? `${count} ${count === 1 ? 'entry' : 'entries'}`}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  balance: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  period: { flex: 1 },
  periods: { flexDirection: 'row', gap: 12 },
  skeletons: { gap: 10 },
});
