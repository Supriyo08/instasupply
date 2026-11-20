import { CITIES, formatPhone, pluralize, VEHICLE_CLASSES, type UserPreferences } from '@instasupply/shared';
import { useConfig } from '@instasupply/api-client/react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';

import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Money,
  Row,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { useNotifications } from '@/features/notifications/hooks';
import { PUSH_UNAVAILABLE_TEXT } from '@/features/notifications/push-availability';
import { usePushPermission, type PushPermissionStatus } from '@/features/notifications/usePushPermission';
import { sendTestNotification, updatePreferences } from '@/features/profile/profile-actions';
import { useSignOut } from '@/features/profile/useSignOut';
import { vehicleTitle } from '@/features/vehicle/vehicle-form';
import { describeError } from '@/lib/api';
import { appVersion, env } from '@/lib/env';
import { callPhone } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

type PushPreference = Extract<keyof UserPreferences, 'jobPush' | 'chatPush'>;

/**
 * Profile (MARKETPLACE §10, CLIENTS §4.6): the session profile (stats, vehicle, city), push
 * preferences through `api.session.updateProfile`, a test notification and sign-out (§2.5). The city is
 * read-only: drivers change it through support.
 */
export default function ProfileScreen() {
  const { user, profile } = useDriver();
  const { colors } = useTheme();
  const config = useConfig();
  const { signOut, busy: signingOut } = useSignOut();
  const { unread } = useNotifications(user.uid);
  const permission = usePushPermission();
  const [saving, setSaving] = useState<Partial<Record<PushPreference, boolean>>>({});
  const [testing, setTesting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const vehicle = profile.vehicle ?? null;
  const pendingVehicle = !!profile.vehicleDraft || profile.vehicleReviewRequired === true;
  const verified = profile.compliance?.licenceVerified && profile.compliance.insuranceVerified;
  const deliveries = profile.driverStats?.deliveries ?? 0;
  const supportPhone = config?.supportPhone ?? null;

  const preference = (key: PushPreference) => saving[key] ?? profile.preferences?.[key] !== false;

  const toggle = async (key: PushPreference, value: boolean) => {
    setSaving((current) => ({ ...current, [key]: value }));
    try {
      await updatePreferences({ [key]: value });
    } catch (cause) {
      notify("Couldn't save", describeError(cause));
    } finally {
      setSaving((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const devices = await sendTestNotification();
      notify(
        'Test sent',
        devices > 0
          ? `Sent to ${pluralize(devices, 'device')}. It also appears in your inbox.`
          : 'No device with push alerts is registered yet, but it appears in your inbox.',
      );
    } catch (cause) {
      notify("Couldn't send", describeError(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Screen edges={[]}>
      <View style={styles.hero}>
        <Avatar name={profile.displayName} size={64} />
        <View style={styles.flex}>
          <Text variant="title" accessibilityRole="header">
            {profile.displayName}
          </Text>
          <Text color="muted">{user.email ?? profile.email}</Text>
          <View style={styles.badges}>
            <Badge label="Approved driver" tone="success" icon="shield-checkmark" />
            {vehicle ? <Badge label={VEHICLE_CLASSES[vehicle.capacityClass].label} tone="brand" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Text
            variant="title"
            accessibilityLabel={`${pluralize(deliveries, 'delivery', 'deliveries')} completed`}
          >
            {deliveries}
          </Text>
          <Text variant="caption" color="subtle">
            Deliveries completed
          </Text>
        </Card>
        <Card style={styles.stat}>
          <Money variant="title" cents={profile.driverStats?.earnedCents ?? 0} />
          <Text variant="caption" color="subtle">
            Earned with InstaSupply
          </Text>
        </Card>
      </View>

      <SectionHeader title="Account" />
      <Card>
        <Row
          icon="location-outline"
          label="City"
          value={profile.cityId ? CITIES[profile.cityId].name : 'Not set'}
          trailing={
            supportPhone ? (
              <Button
                label="Change via support"
                variant="ghost"
                onPress={() => void callPhone(supportPhone)}
                accessibilityHint={`Calls InstaSupply support at ${formatPhone(supportPhone)}`}
              />
            ) : undefined
          }
        />
        <Row
          icon="call-outline"
          label="Mobile number"
          value={profile.phoneNumber ? formatPhone(profile.phoneNumber) : 'Not verified'}
        />
        <Row
          icon="id-card-outline"
          label="Licence and insurance"
          value={verified ? 'Verified by ops' : 'Attested, waiting for ops to verify'}
        />
        <Row
          icon="car-outline"
          label="Vehicle"
          value={vehicle ? `${vehicleTitle(vehicle)} · ${vehicle.plate}` : 'Not set'}
          trailing={pendingVehicle ? <Badge label="Pending review" tone="warning" /> : undefined}
          onPress={() => router.push('/vehicle')}
        />
        <Row icon="time-outline" label="Delivery history" onPress={() => router.push('/history')} />
        <Row
          icon="notifications-outline"
          label="Notifications"
          value={unread > 0 ? `${unread} unread` : null}
          onPress={() => router.push('/notifications')}
        />
      </Card>

      <SectionHeader title="Push alerts" />
      <Card style={styles.card}>
        <PushPermissionNote permission={permission.status} onEnable={permission.enable} />
        <Row
          icon="briefcase-outline"
          label="Job alerts"
          value="New jobs on the board for your city and vehicle"
          trailing={
            <Switch
              accessibilityLabel="Job alerts"
              value={preference('jobPush')}
              disabled={saving.jobPush !== undefined}
              onValueChange={(value) => void toggle('jobPush', value)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          }
        />
        <Row
          icon="chatbubble-ellipses-outline"
          label="Dispatch messages"
          value="Push alerts for new messages from dispatch"
          trailing={
            <Switch
              accessibilityLabel="Dispatch message alerts"
              value={preference('chatPush')}
              disabled={saving.chatPush !== undefined}
              onValueChange={(value) => void toggle('chatPush', value)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          }
        />
        <Text variant="caption" color="subtle">
          Assignments, job changes and payouts always reach your inbox.
        </Text>
        <Button
          label="Send a test notification"
          variant="secondary"
          icon="notifications-outline"
          loading={testing}
          onPress={() => void sendTest()}
        />
      </Card>

      {confirmSignOut ? (
        <Card style={styles.card}>
          <Text variant="bodyStrong">Sign out of InstaSupply?</Text>
          <Text color="muted">
            You go offline and stop getting job alerts on this phone until you sign in again.
          </Text>
          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="ghost"
              disabled={signingOut}
              onPress={() => setConfirmSignOut(false)}
              style={styles.flex}
            />
            <Button
              label="Sign out"
              variant="danger"
              icon="log-out-outline"
              loading={signingOut}
              onPress={() => void signOut()}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : (
        <Button
          label="Sign out"
          variant="secondary"
          icon="log-out-outline"
          onPress={() => setConfirmSignOut(true)}
        />
      )}
      <Text variant="caption" color="subtle" align="center">
        InstaSupply Driver {appVersion}
        {__DEV__ ? ` · ${env.variant} · ${env.apiUrl}` : ''}
      </Text>
    </Screen>
  );
}

/** What push can do on this phone, and the one action that fixes it (CLIENTS §6.2, §6.7). */
function PushPermissionNote({
  permission,
  onEnable,
}: {
  permission: PushPermissionStatus;
  onEnable: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (permission === 'granted' || permission === 'checking') return null;
  if (permission === 'unavailable') return <Banner tone="info" message={PUSH_UNAVAILABLE_TEXT} />;
  if (permission === 'blocked') {
    return (
      <View style={styles.note}>
        <Banner
          tone="warning"
          title="Notifications are off for InstaSupply"
          message="Turn them on in your phone's settings so you don't miss jobs and dispatch messages."
        />
        <Button
          label="Open settings"
          variant="secondary"
          icon="settings-outline"
          onPress={() => void Linking.openSettings()}
        />
      </View>
    );
  }
  return (
    <View style={styles.note}>
      <Banner
        tone="warning"
        title="Turn on notifications"
        message="Job offers and dispatch messages arrive as push alerts."
      />
      <Button
        label="Turn on notifications"
        icon="notifications-outline"
        loading={busy}
        onPress={() => {
          setBusy(true);
          void onEnable().finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  card: { gap: 8 },
  flex: { flex: 1, gap: 2 },
  hero: { alignItems: 'center', flexDirection: 'row', gap: 16, marginTop: 8 },
  note: { gap: 8 },
  stat: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', gap: 10 },
});
