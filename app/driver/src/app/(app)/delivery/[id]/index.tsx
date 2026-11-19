import {
  formatCurrency,
  formatDateTime,
  isActiveStatus,
  primaryDriverAction,
  toMillis,
} from '@instasupply/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  IconButton,
  Row,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { DeclineSheet } from '@/features/deliveries/DeclineSheet';
import { DeliveryTags } from '@/features/deliveries/DeliveryCard';
import { EventTimeline } from '@/features/deliveries/EventTimeline';
import { useDelivery, useDeliveryEvents, useRoutePlan } from '@/features/deliveries/hooks';
import { ProgressSteps } from '@/features/deliveries/ProgressSteps';
import { useDeliveryAction } from '@/features/deliveries/useDeliveryAction';
import { usePresence } from '@/features/location/PresenceProvider';
import { RouteMap } from '@/features/route/RouteMap';
import { callPhone, openNavigation, textPhone } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useDriver();
  const { radius } = useTheme();
  const { data: delivery, loading } = useDelivery(id);
  const events = useDeliveryEvents(id);
  const route = useRoutePlan(user.uid);
  const { lastFix } = usePresence();
  const { run, busyId } = useDeliveryAction();
  const [declining, setDeclining] = useState(false);

  const stopNumber = useMemo(() => {
    const index = route.data?.stops.findIndex((stop) => stop.deliveryId === id) ?? -1;
    return index >= 0 ? index + 1 : null;
  }, [route.data, id]);

  if (!delivery) {
    return (
      <Screen edges={[]}>
        {loading ? null : (
          <EmptyState
            icon="cube-outline"
            title="Delivery unavailable"
            message="It may have been reassigned or cancelled by dispatch."
            action={<Button label="Back to today" fullWidth={false} onPress={() => router.back()} />}
          />
        )}
      </Screen>
    );
  }

  const mine = delivery.driverId === user.uid;
  const active = mine && isActiveStatus(delivery.status);
  const action = active ? primaryDriverAction(delivery.status) : null;
  const canReportProblem = active && delivery.status !== 'assigned';
  const phone = delivery.customer.phone;

  const onPrimary = () => {
    if (!action) return;
    if (action.requiresProof) router.push(`/delivery/${delivery.id}/complete`);
    else void run(delivery.id, action.to);
  };

  const footer = active ? (
    <>
      {action ? (
        <Button
          label={action.label}
          size="lg"
          icon={action.requiresProof ? 'checkmark-done' : 'arrow-forward'}
          loading={busyId === delivery.id}
          onPress={onPrimary}
        />
      ) : null}
      {delivery.status === 'assigned' ? (
        <Button label="Decline" variant="ghost" onPress={() => setDeclining(true)} />
      ) : null}
      {canReportProblem ? (
        <Button
          label="Report a problem"
          variant="ghost"
          icon="alert-circle-outline"
          onPress={() => router.push(`/delivery/${delivery.id}/fail`)}
        />
      ) : null}
    </>
  ) : undefined;

  return (
    <Screen edges={[]} footer={footer}>
      <Stack.Screen options={{ title: delivery.orderId }} />

      <RouteMap
        style={{ ...styles.map, borderRadius: radius.lg }}
        interactive={false}
        driver={active && lastFix ? { lat: lastFix.lat, lng: lastFix.lng, heading: lastFix.heading } : null}
        stops={[
          {
            id: delivery.id,
            location: delivery.location,
            label: stopNumber ? String(stopNumber) : '•',
            title: delivery.customer.name,
            status: delivery.status,
            highlighted: true,
          },
        ]}
        path={[]}
      />

      <View style={styles.titleBlock}>
        <Text variant="title">{delivery.customer.name}</Text>
        <DeliveryTags delivery={delivery} />
      </View>
      <ProgressSteps status={delivery.status} />

      {delivery.status === 'delivered' && delivery.proof ? (
        <Banner
          tone="success"
          title={`Delivered ${formatDateTime(toMillis(delivery.deliveredAt))}`}
          message={
            [
              delivery.proof.recipientName ? `Received by ${delivery.proof.recipientName}` : null,
              delivery.proof.codCollected != null
                ? `${formatCurrency(delivery.proof.codCollected)} collected`
                : null,
              delivery.proof.photoPath ? 'Photo on file' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Proof of delivery recorded.'
          }
        />
      ) : null}
      {delivery.status === 'failed' && delivery.failure ? (
        <Banner
          tone="danger"
          title="Delivery failed"
          message={delivery.failure.note ?? 'Dispatch will follow up.'}
        />
      ) : null}
      {!mine ? <Banner tone="warning" message="This delivery is no longer assigned to you." /> : null}

      <SectionHeader title="Drop-off" />
      <Card>
        <Row icon="location-outline" label="Address" value={delivery.address} />
        {delivery.addressNotes ? (
          <Row icon="information-circle-outline" label="Directions" value={delivery.addressNotes} />
        ) : null}
        {delivery.windowEnd ? (
          <Row
            icon="time-outline"
            label="Delivery window"
            value={`${delivery.windowStart ? `${formatDateTime(delivery.windowStart)} – ` : 'By '}${formatDateTime(delivery.windowEnd)}`}
          />
        ) : null}
        <View style={styles.contactRow}>
          <Button
            label="Navigate"
            icon="navigate"
            fullWidth={false}
            style={styles.flex}
            onPress={() => void openNavigation(delivery.location, { origin: lastFix })}
          />
          {phone ? (
            <>
              <IconButton
                icon="call"
                label="Call customer"
                tone="success"
                size={46}
                onPress={() => void callPhone(phone)}
              />
              <IconButton
                icon="chatbox-ellipses"
                label="Text customer"
                tone="primary"
                size={46}
                onPress={() =>
                  void textPhone(
                    phone,
                    `Hi ${delivery.customer.name.split(' ')[0]}, this is your InstaSupply driver.`,
                  )
                }
              />
            </>
          ) : null}
        </View>
      </Card>

      <SectionHeader title="Package" />
      <Card>
        <Row icon="cube-outline" label="Packages" value={String(delivery.packageCount)} />
        {delivery.codAmount ? (
          <Row icon="cash-outline" label="Cash on delivery" value={formatCurrency(delivery.codAmount)} />
        ) : null}
        {delivery.requireCode ? (
          <Row
            icon="key-outline"
            label="Hand-off code"
            value="Ask the customer for the 4-digit code from their tracking page."
          />
        ) : null}
        {delivery.notes ? (
          <Row icon="document-text-outline" label="Notes from dispatch" value={delivery.notes} />
        ) : null}
      </Card>

      <SectionHeader title="Activity" />
      <Card>
        <EventTimeline events={events.data} />
      </Card>

      <DeclineSheet
        deliveryId={declining ? delivery.id : null}
        onClose={() => setDeclining(false)}
        onDeclined={() => router.back()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  contactRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 6 },
  flex: { flex: 1 },
  map: { height: 180 },
  titleBlock: { gap: 8 },
});
