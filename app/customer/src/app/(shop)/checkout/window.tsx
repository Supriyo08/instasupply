import { formatDayET, formatWindowET, fromLocal, type WindowOption } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, EmptyState, ErrorState, Header, Notice, Screen, Text } from '@/components/ui';
import { updateCheckoutDraft } from '@/features/checkout/checkout-draft';
import { OptionRow } from '@/features/checkout/OptionRow';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { useCheckout } from '@/features/checkout/useCheckout';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme/tokens';

const NOON = 12 * 60;

function choose(option: WindowOption) {
  updateCheckoutDraft({ windowId: option.id, serverWindows: null });
  router.back();
}

function WindowPicker() {
  const { user } = useCustomer();
  const checkout = useCheckout(user.uid);
  const now = useNow(30_000);
  const { windows, selectedWindow } = checkout;

  const days = useMemo(() => {
    const dates: string[] = [];
    for (const option of windows ?? []) {
      if (option.kind === 'scheduled' && !dates.includes(option.date)) dates.push(option.date);
    }
    return dates;
  }, [windows]);
  const [day, setDay] = useState<string | null>(
    selectedWindow?.kind === 'scheduled' ? selectedWindow.date : null,
  );
  const shownDay =
    day ?? days.find((date) => windows?.some((o) => o.date === date && o.available)) ?? days[0];

  const header = <Header title="Delivery time" />;
  if (checkout.loading) {
    return (
      <Screen header={header}>
        <OptionCardsSkeleton count={4} label="Loading delivery times" />
      </Screen>
    );
  }
  if (checkout.error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load delivery times" error={checkout.error} onRetry={checkout.retry} />
      </Screen>
    );
  }
  if (!windows) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-jobsite-delivery"
          title="No delivery times yet"
          message="Choose a jobsite and make sure every store in your cart can deliver there, then pick a time."
        />
      </Screen>
    );
  }

  const asap = windows.find((option) => option.kind === 'asap');
  const slots = windows.filter((option) => option.kind === 'scheduled' && option.date === shownDay);
  return (
    <Screen header={header}>
      {asap ? (
        <View style={styles.section}>
          <Text variant="heading">As soon as possible</Text>
          <OptionRow
            title={asap.available ? asap.label : 'ASAP'}
            detail={asap.available ? 'Every store sends its part as soon as it is ready' : asap.reason}
            icon="zap"
            disabled={!asap.available}
            selected={selectedWindow?.id === asap.id}
            onPress={() => choose(asap)}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="heading">Schedule</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.days}
          style={styles.dayScroller}
          accessibilityRole="tablist"
        >
          {days.map((date) => (
            <Chip
              key={date}
              label={formatDayET(fromLocal(date, NOON), now)}
              selected={date === shownDay}
              onPress={() => setDay(date)}
            />
          ))}
        </ScrollView>
        {slots.length === 0 ? (
          <Notice tone="info" message="No delivery windows on this day. Try another day." />
        ) : (
          <View accessibilityRole="radiogroup" style={styles.slots}>
            {slots.map((option) => (
              <OptionRow
                key={option.id}
                title={
                  option.startAt != null && option.endAt != null
                    ? formatWindowET(option.startAt, option.endAt)
                    : option.label
                }
                detail={option.available ? null : option.reason}
                icon="clock"
                disabled={!option.available}
                selected={selectedWindow?.id === option.id}
                onPress={() => choose(option)}
              />
            ))}
          </View>
        )}
      </View>
      <Text variant="caption" color="muted">
        Deliveries run in 2-hour windows until 7 pm. Book at least 90 minutes ahead.
      </Text>
    </Screen>
  );
}

/** Day chips (today … +6) and 2-hour slots, unavailable ones with their reason (MARKETPLACE §4.4). */
export default function CheckoutWindowScreen() {
  return (
    <RequireAccount title="Delivery time">
      <WindowPicker />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  dayScroller: { marginHorizontal: -spacing.gutter },
  days: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  section: { gap: spacing.md },
  slots: { gap: spacing.sm },
});
