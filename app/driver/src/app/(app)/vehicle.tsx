import { VEHICLE_CLASSES, type DriverVehicle } from '@instasupply/shared';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Banner, Button, Card, EmptyState, Screen, SectionHeader, Text } from '@/components/ui';
import { submitVehicle } from '@/features/auth/auth-service';
import { useDriver } from '@/features/auth/SessionProvider';
import {
  checkVehicle,
  vehicleChanged,
  vehicleDetails,
  vehicleFormFrom,
  vehicleInputOf,
  vehicleTitle,
  type VehicleFormErrors,
} from '@/features/vehicle/vehicle-form';
import { VehicleFields } from '@/features/vehicle/VehicleFields';
import { api, describeError } from '@/lib/api';

/**
 * The approved vehicle and its capacity class (set by ops), and a change request (MARKETPLACE §10,
 * CLIENTS §4.6). A change goes to `vehicleDraft` through `updateDriverVehicle` and shows "Pending
 * review" until ops approve it; jobs keep matching the approved vehicle until then.
 */
export default function VehicleScreen() {
  const { profile } = useDriver();
  const approved = profile.vehicle ?? null;
  const draft = profile.vehicleDraft ?? null;
  const pending = !!draft || profile.vehicleReviewRequired === true;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => vehicleFormFrom(draft ?? approved));
  const [errors, setErrors] = useState<VehicleFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Once a check has failed, every edit checks again, so a fixed field loses its message at once.
  const change = (next: typeof value) => {
    setValue(next);
    if (Object.keys(errors).length > 0) {
      const checked = checkVehicle(next, api.serverNow());
      setErrors(checked.ok ? {} : checked.errors);
    }
  };

  const startEditing = () => {
    setValue(vehicleFormFrom(draft ?? approved));
    setErrors({});
    setError(null);
    setSent(false);
    setEditing(true);
  };

  const submit = async () => {
    const checked = checkVehicle(value, api.serverNow());
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    if (!vehicleChanged(value, draft ?? (approved ? vehicleInputOf(approved) : null))) {
      setError('Nothing has changed yet.');
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      await submitVehicle(checked.value);
      setEditing(false);
      setSent(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      edges={[]}
      keyboard
      footer={
        editing ? (
          <>
            <Button
              label="Send for review"
              size="lg"
              icon="send-outline"
              loading={busy}
              onPress={() => void submit()}
              accessibilityHint="Ops review the change before jobs use it"
            />
            <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => setEditing(false)} />
          </>
        ) : undefined
      }
    >
      {sent ? (
        <Banner
          tone="success"
          title="Sent for review"
          message="Ops review the change. Jobs keep matching your approved vehicle until then."
        />
      ) : null}

      {approved ? (
        <VehicleCard
          vehicle={approved}
          heading="Approved vehicle"
          classNote="Capacity class, set by ops"
          badge={<Badge label="Approved" tone="success" icon="shield-checkmark" />}
        />
      ) : (
        <EmptyState
          icon="car-outline"
          title="No approved vehicle yet"
          message="Ops approve the vehicle you declared when they confirm your account."
        />
      )}

      {pending ? (
        <>
          <SectionHeader title="Change waiting for ops" />
          {draft ? (
            <VehicleCard
              vehicle={draft}
              heading="Requested change"
              classNote="Expected class"
              badge={<Badge label="Pending review" tone="warning" icon="time-outline" />}
            />
          ) : (
            <Banner
              tone="warning"
              title="Pending review"
              message="Ops are reviewing your vehicle. Until they approve it, only jobs your approved vehicle can carry are shown."
            />
          )}
        </>
      ) : null}

      {editing ? (
        <>
          <SectionHeader title={draft ? 'Update your request' : 'Request a change'} />
          {error ? <Banner tone="danger" message={error} /> : null}
          <VehicleFields value={value} onChange={change} errors={errors} disabled={busy} />
        </>
      ) : (
        <>
          <Button
            label={draft ? 'Edit the requested change' : approved ? 'Request a change' : 'Add your vehicle'}
            variant="secondary"
            icon="create-outline"
            onPress={startEditing}
          />
          <Text variant="caption" color="subtle" align="center">
            New truck, a trailer or a liftgate? A bigger vehicle unlocks bigger jobs once ops approve it.
          </Text>
        </>
      )}
    </Screen>
  );
}

function VehicleCard({
  vehicle,
  heading,
  classNote,
  badge,
}: {
  vehicle: DriverVehicle;
  heading: string;
  classNote: string;
  badge: ReactNode;
}) {
  const spec = VEHICLE_CLASSES[vehicle.capacityClass];
  const title = vehicleTitle(vehicle);
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <Text variant="caption" color="subtle">
          {heading}
        </Text>
        {badge}
      </View>
      <Text variant="heading">{title}</Text>
      <Text color="muted">{vehicleDetails(vehicleInputOf(vehicle))}</Text>
      <View style={styles.plate}>
        <Text variant="bodyStrong">{vehicle.plate}</Text>
      </View>
      <View style={styles.classRow}>
        <View style={styles.flex}>
          <Text variant="caption" color="subtle">
            {classNote}
          </Text>
          <Text variant="bodyStrong">{spec.label}</Text>
        </View>
        <View style={styles.flex}>
          <Text variant="caption" color="subtle">
            Carries up to
          </Text>
          <Text variant="bodyStrong">
            {spec.maxKg.toLocaleString('en-CA')} kg · {(spec.maxLengthCm / 100).toFixed(1)} m
            {spec.sheets ? ' · 4×8 sheets' : ''}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  cardHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  classRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  flex: { flex: 1, gap: 2 },
  plate: { alignSelf: 'flex-start', marginTop: 4 },
});
