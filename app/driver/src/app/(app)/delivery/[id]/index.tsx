import {
  STATUS_META,
  failureReasonLabel,
  formatClockET,
  formatDateTimeET,
  formatMoney,
  formatPhone,
  isSiteCausedFailure,
  primaryDriverAction,
  requiresPickup,
  type Delivery,
} from '@instasupply/shared';
import { useConfig } from '@instasupply/api-client/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppMap, fitKeyFor, type MapMarker } from '@/components/map';
import {
  Badge,
  Banner,
  Button,
  Card,
  CheckRow,
  EmptyState,
  ErrorState,
  IconButton,
  Row,
  Screen,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Text,
} from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { checkInAtStore } from '@/features/deliveries/actions';
import { DeclineSheet } from '@/features/deliveries/DeclineSheet';
import { DeliveryStepper, PinCard, ReleaseSheet } from '@/features/deliveries/DeliveryParts';
import { EventTimeline } from '@/features/deliveries/EventTimeline';
import { useDelivery, useDeliveryEvents, useOrderedStops } from '@/features/deliveries/hooks';
import { storeHoursText, useStore } from '@/features/deliveries/store';
import { notify, useDeliveryAction } from '@/features/deliveries/useDeliveryAction';
import { classLabel, feetText, weightText, windowText } from '@/features/jobs/format';
import { usePresence } from '@/features/location/PresenceProvider';
import { driverMarker } from '@/features/route/route-map';
import { describeError } from '@/lib/api';
import { callPhone, openNavigation, textPhone } from '@/lib/links';
import { useNow } from '@/lib/use-now';

/** What the driver should know about unloading at the site (MARKETPLACE §10 "Unloading note"). */
function unloadingNote(delivery: Delivery): {
  tone: 'info' | 'warning' | 'success';
  text: string;
  phone: string | null;
} {
  const unload = delivery.unload;
  if (unload?.labourer && unload.status === 'booked') {
    return {
      tone: 'success',
      text: `Labourer booked: ${unload.labourerName ?? 'name to follow'} meets you at the site to unload.`,
      phone: unload.labourerPhone,
    };
  }
  if (unload?.labourer) {
    return {
      tone: 'info',
      text: 'A labourer is being booked for this site. Dispatch confirms the name.',
      phone: null,
    };
  }
  if (delivery.receiving === 'attended') {
    return {
      tone: 'info',
      text: 'Site crew helps you unload. Ask the person receiving it for the hand-off code.',
      phone: null,
    };
  }
  if (delivery.load?.heavy) {
    return {
      tone: 'warning',
      text: 'Heavy load and nobody on site: call ops before you unload anything alone.',
      phone: null,
    };
  }
  return {
    tone: 'info',
    text: 'Nobody receives this load: unload where the instructions say and take the drop-off photo.',
    phone: null,
  };
}

/**
 * One delivery, store to site (MARKETPLACE §10 `delivery/[id]`, CLIENTS §4.6, §7.4). The PIN card and
 * the store's confirmation update live through `delivery:{id}`. Route order and ETAs come from
 * `useOrderedStops`, never from the raw plan (R56, R61).
 */
export default function DeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useDriver();
  const delivery = useDelivery(id);
  const events = useDeliveryEvents(id);
  const { stops } = useOrderedStops(user.uid);
  const store = useStore(delivery.data?.pickup?.storeId ?? null);
  const config = useConfig();
  const presence = usePresence();
  const now = useNow();
  const { run, busyId } = useDeliveryAction();
  const [checkingIn, setCheckingIn] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set());

  const data = delivery.data;
  const map = useMemo(() => {
    if (!data) return null;
    const markers: MapMarker[] = [];
    if (data.pickup && requiresPickup(data)) {
      markers.push({
        id: 'store',
        kind: 'store',
        position: data.pickup.location,
        title: data.pickup.storeName,
        tone: 'warning',
      });
    }
    markers.push({ id: 'site', kind: 'site', position: data.location, title: data.address, tone: 'brand' });
    const fitPoints = markers.map((marker) => marker.position);
    const driver = driverMarker(presence.lastFix);
    if (driver) markers.push(driver);
    return { markers, fit: { key: fitKeyFor(fitPoints), points: markers.map((marker) => marker.position) } };
  }, [data, presence.lastFix]);

  if (delivery.loading) {
    return (
      <Screen edges={[]}>
        <Skeleton height={40} />
        <Skeleton height={180} radius={16} />
        <Skeleton height={140} radius={16} />
      </Screen>
    );
  }
  if (delivery.error) {
    return (
      <Screen edges={[]}>
        <ErrorState error={delivery.error} onRetry={delivery.retry} title="Couldn't load this delivery" />
      </Screen>
    );
  }
  if (!data || !map) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="file-tray-outline"
          title="This delivery is not on your route"
          message="It was released, reassigned by dispatch or cancelled by the store."
          action={<Button label="Back to Today" fullWidth={false} onPress={() => router.dismissTo('/')} />}
        />
      </Screen>
    );
  }

  const pickup = data.pickup;
  const atStore = requiresPickup(data);
  const action = primaryDriverAction(data);
  const busy = busyId === data.id || checkingIn;
  const pickupStop = stops.find((stop) => stop.key === `${data.id}:pickup`) ?? null;
  const dropoffStop = stops.find((stop) => stop.key === `${data.id}:dropoff`) ?? null;
  const supportPhone = config?.supportPhone ?? null;
  const terminal = data.status === 'delivered' || data.status === 'failed' || data.status === 'cancelled';
  const canRelease = data.status === 'accepted' && (atStore || !pickup);
  const canReport = data.status === 'picked_up' || data.status === 'in_transit' || data.status === 'arrived';
  const note = unloadingNote(data);
  const hours = storeHoursText(store.data, now);
  const lines = data.load?.lines ?? [];

  const checkIn = async () => {
    setCheckingIn(true);
    try {
      const position = await presence.currentPosition();
      await checkInAtStore(data.id, position ? { lat: position.lat, lng: position.lng } : null);
    } catch (cause) {
      notify("Couldn't check you in", describeError(cause));
    } finally {
      setCheckingIn(false);
    }
  };

  const primary = (() => {
    if (!action) return null;
    switch (action.kind) {
      case 'check_in':
        return (
          <Button
            label={action.label}
            icon="storefront-outline"
            size="lg"
            loading={busy}
            onPress={() => void checkIn()}
          />
        );
      case 'wait':
        return <Button label={action.label} icon="hourglass-outline" size="lg" disabled />;
      case 'show_pin':
        // The PIN card is the action: nothing to press until the store has typed it in.
        return null;
      case 'status':
        if (action.requiresProof) {
          return (
            <Button
              label={action.label}
              icon="camera-outline"
              size="lg"
              variant="success"
              onPress={() => router.push(`/delivery/${data.id}/complete`)}
            />
          );
        }
        return (
          <Button
            label={action.label}
            icon={action.to === 'accepted' ? 'checkmark' : 'arrow-forward'}
            size="lg"
            loading={busy}
            disabled={action.disabled}
            onPress={() => void run(data.id, action.to)}
          />
        );
    }
  })();

  const footer = terminal ? null : (
    <>
      {primary}
      <View style={styles.secondary}>
        {data.status === 'assigned' ? (
          <Button
            label="Decline"
            variant="secondary"
            style={styles.flex}
            onPress={() => setDeclining(true)}
          />
        ) : null}
        {canRelease ? (
          <Button
            label="Release job"
            variant="ghost"
            style={styles.flex}
            onPress={() => setReleasing(true)}
          />
        ) : null}
        {canReport ? (
          <Button
            label="Report a problem"
            variant="ghost"
            icon="alert-circle-outline"
            style={styles.flex}
            onPress={() => router.push(`/delivery/${data.id}/fail`)}
          />
        ) : null}
      </View>
    </>
  );

  return (
    <Screen edges={[]} footer={footer} onRefresh={delivery.retry} refreshing={delivery.refreshing}>
      <View style={styles.headline}>
        <View style={styles.flex}>
          <Text variant="title">{data.orderId}</Text>
          <Text variant="caption" color="muted">
            {windowText(data.windowStart, data.windowEnd, now)}
            {data.vehicleClass ? ` · ${classLabel(data.vehicleClass)}` : ''}
            {data.payout ? ` · ${formatMoney(data.payout.totalCents)}` : ''}
          </Text>
        </View>
        <StatusBadge status={data.status} />
      </View>
      <DeliveryStepper delivery={data} />

      {data.status === 'delivered' ? (
        <Banner
          tone="success"
          title="Delivered"
          message={`${data.deliveredAt ? formatDateTimeET(data.deliveredAt, now) : ''}${data.proof?.recipientName ? ` · received by ${data.proof.recipientName}` : ''}${data.proof?.photoPath ? ' · photo on file' : ''}`}
        />
      ) : null}
      {data.status === 'failed' ? (
        <Banner
          tone="danger"
          title={`Failed: ${failureReasonLabel(data.failure?.reason)}`}
          message={
            isSiteCausedFailure(data.failure?.reason)
              ? 'The site caused it, so you are still paid for the trip. Dispatch decides what happens to the load.'
              : 'Dispatch decides what happens to the load. Keep it on your vehicle until they call.'
          }
        />
      ) : null}
      {data.status === 'cancelled' ? (
        <Banner
          tone="warning"
          title={STATUS_META.cancelled.label}
          message="The store or customer cancelled this order."
        />
      ) : null}

      {!terminal ? (
        <AppMap
          markers={map.markers}
          fit={map.fit}
          style={styles.map}
          accessibilityLabel={`Map: ${atStore && pickup ? `${pickup.storeName}, then ` : ''}the site at ${data.address}${presence.lastFix ? ', and your position' : ''}`}
        />
      ) : null}

      {pickup && atStore && pickup.arrivedAt != null && pickup.pickupCode ? (
        <PinCard code={pickup.pickupCode} ready={pickup.ready} />
      ) : null}

      {pickup ? (
        <>
          <SectionHeader title={atStore ? '① Store pickup' : '① Store pickup · done'} />
          <Card>
            <View style={styles.blockTop}>
              <View style={styles.flex}>
                <Text variant="heading">{pickup.storeName}</Text>
                <Text color="muted">{pickup.address}</Text>
              </View>
              <IconButton
                icon="call"
                label={`Call ${pickup.storeName}, ${formatPhone(pickup.phone)}`}
                tone="success"
                onPress={() => void callPhone(pickup.phone)}
              />
            </View>
            <View style={styles.badges}>
              {pickup.collectedAt != null ? (
                <Badge
                  label={`Loaded ${formatClockET(pickup.collectedAt)}`}
                  tone="success"
                  icon="checkmark"
                />
              ) : pickup.ready ? (
                <Badge label="Ready ✓" tone="success" />
              ) : (
                <Badge label={`Being prepared, ready by ${formatClockET(pickup.readyBy)}`} tone="warning" />
              )}
              {pickup.arrivedAt != null && pickup.collectedAt == null ? (
                <Badge label={`Checked in ${formatClockET(pickup.arrivedAt)}`} tone="info" />
              ) : null}
              {pickupStop?.etaAt && atStore && pickup.arrivedAt == null ? (
                <Badge label={`ETA ${formatClockET(pickupStop.etaAt)}`} tone="neutral" />
              ) : null}
            </View>
            {hours ? <Row icon="time-outline" label="Hours" value={hours} /> : null}
            <Row icon="call-outline" label="Phone" value={formatPhone(pickup.phone)} />
            {pickup.loadingNotes ? (
              <Row icon="information-circle-outline" label="Loading notes" value={pickup.loadingNotes} />
            ) : null}
            {atStore ? (
              <Button
                label="Navigate to the store"
                icon="navigate"
                variant="secondary"
                onPress={() => void openNavigation(pickup.location, { origin: presence.lastFix })}
              />
            ) : null}
          </Card>
        </>
      ) : null}

      {data.load && lines.length > 0 && !terminal ? (
        <>
          <SectionHeader title={`Load checklist · ${ticked.size}/${lines.length}`} />
          <Card>
            <Text variant="caption" color="muted">
              {data.load.pieces} pieces · {weightText(data.load.weightKg)} · longest{' '}
              {feetText(data.load.longestCm)}
              {data.load.hasSheets ? ' · 4×8 sheets' : ''}. Tick each line as it goes on your vehicle; the
              ticks stay on this phone.
            </Text>
            {lines.map((line, index) => (
              <CheckRow
                key={`${line.name}-${index}`}
                label={`${line.quantity} × ${line.name}`}
                detail={[line.size, `${weightText(line.weightKg * line.quantity)}`]
                  .filter(Boolean)
                  .join(' · ')}
                checked={ticked.has(index)}
                onToggle={() =>
                  setTicked((current) => {
                    const nextSet = new Set(current);
                    if (nextSet.has(index)) nextSet.delete(index);
                    else nextSet.add(index);
                    return nextSet;
                  })
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title={pickup ? '② Site drop-off' : 'Site drop-off'} />
      <Card>
        <View style={styles.blockTop}>
          <View style={styles.flex}>
            <Text variant="heading">{data.address}</Text>
            <Text color="muted">
              {data.customer.name}
              {data.customer.phone ? ` · ${formatPhone(data.customer.phone)}` : ''}
            </Text>
          </View>
          {data.customer.phone ? (
            <View style={styles.contact}>
              <IconButton
                icon="chatbubble-outline"
                label={`Text ${data.customer.name}`}
                onPress={() => void textPhone(data.customer.phone ?? '')}
              />
              <IconButton
                icon="call"
                label={`Call ${data.customer.name}`}
                tone="success"
                onPress={() => void callPhone(data.customer.phone ?? '')}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.badges}>
          <Badge
            label={
              data.receiving === 'attended'
                ? 'Someone receives it · hand-off code'
                : 'Unattended · photo drop'
            }
            tone={data.receiving === 'attended' ? 'info' : 'neutral'}
          />
          {dropoffStop?.etaAt && !terminal ? (
            <Badge label={`ETA ${formatClockET(dropoffStop.etaAt)}`} tone="neutral" />
          ) : null}
        </View>
        <Row
          icon="calendar-outline"
          label="Window"
          value={windowText(data.windowStart, data.windowEnd, now)}
        />
        {data.addressNotes ? (
          <Row icon="document-text-outline" label="Site instructions" value={data.addressNotes} />
        ) : null}
        {!atStore && !terminal ? (
          <Button
            label="Navigate to the site"
            icon="navigate"
            variant="secondary"
            onPress={() => void openNavigation(data.location, { origin: presence.lastFix })}
          />
        ) : null}
      </Card>

      {!terminal ? <Banner tone={note.tone} title="Unloading" message={note.text} /> : null}
      {!terminal && (note.phone || (note.tone === 'warning' && supportPhone)) ? (
        <Button
          label={note.phone ? 'Call the labourer' : 'Call ops'}
          icon="call-outline"
          variant="secondary"
          onPress={() => void callPhone(note.phone ?? supportPhone ?? '')}
        />
      ) : null}

      {!terminal ? (
        <Button
          label="Message dispatch"
          icon="chatbubbles-outline"
          variant="ghost"
          onPress={() => router.navigate('/chat')}
        />
      ) : null}

      <SectionHeader title="Activity" />
      <Card>
        {events.loading ? (
          <Skeleton height={60} />
        ) : events.error ? (
          <ErrorState error={events.error} onRetry={events.retry} title="Couldn't load the activity" />
        ) : (
          <EventTimeline events={events.data} />
        )}
      </Card>

      {data.status === 'delivered' ? <SceneArt scene="scene-jobsite-delivery" height={120} /> : null}

      <DeclineSheet
        deliveryId={declining ? data.id : null}
        onClose={() => setDeclining(false)}
        onDeclined={() => router.dismissTo('/')}
      />
      <ReleaseSheet
        deliveryId={data.id}
        visible={releasing}
        onClose={() => setReleasing(false)}
        onReleased={() => router.dismissTo('/')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
  blockTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  contact: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  headline: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  map: { borderRadius: 16, height: 180, overflow: 'hidden' },
  secondary: { flexDirection: 'row', gap: 8 },
});
