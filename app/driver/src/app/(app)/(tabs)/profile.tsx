import { COLLECTIONS, VEHICLE_META } from '@instasupply/shared';
import { router } from 'expo-router';
import {
  collection,
  doc,
  getCountFromServer,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Avatar, Badge, Button, Card, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { useSignOut } from '@/features/profile/useSignOut';
import { call } from '@/lib/callables';
import { appVersion, env } from '@/lib/env';
import { describeError } from '@/lib/errors';
import { db } from '@/lib/firebase';
import { useTheme } from '@/theme/ThemeProvider';

function useLifetimeDelivered(uid: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const deliveredQuery = query(
      collection(db, COLLECTIONS.deliveries),
      where('driverId', '==', uid),
      where('status', '==', 'delivered'),
    );
    getCountFromServer(deliveredQuery)
      .then((snapshot) => setCount(snapshot.data().count))
      .catch(() => setCount(null));
  }, [uid]);
  return count;
}

export default function ProfileScreen() {
  const { user, profile } = useDriver();
  const { colors } = useTheme();
  const delivered = useLifetimeDelivered(user.uid);
  const { signOut, busy } = useSignOut(user.uid);
  const [testing, setTesting] = useState(false);
  const chatPush = profile.preferences?.chatPush !== false;

  const toggleChatPush = async (value: boolean) => {
    try {
      await updateDoc(doc(db, COLLECTIONS.users, user.uid), {
        preferences: { ...profile.preferences, chatPush: value },
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      notify("Couldn't save", describeError(error));
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const result = await call('sendTestNotification', undefined);
      notify(
        'Test sent',
        result.devices > 0
          ? `Sent to ${result.devices} device${result.devices === 1 ? '' : 's'}. It also appears in your inbox.`
          : 'No push-enabled device is registered yet, but it appears in your inbox.',
      );
    } catch (error) {
      notify("Couldn't send", describeError(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Avatar name={profile.displayName} size={64} />
        <View style={styles.flex}>
          <Text variant="title">{profile.displayName}</Text>
          <Text color="muted">{profile.email}</Text>
          <View style={styles.badges}>
            <Badge label="Approved driver" tone="success" icon="shield-checkmark" />
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Text variant="title">{delivered ?? '—'}</Text>
          <Text variant="caption" color="subtle">
            Deliveries completed
          </Text>
        </Card>
        <Card style={styles.stat} onPress={() => router.push('/history')}>
          <Text variant="title" color="primary">
            History
          </Text>
          <Text variant="caption" color="subtle">
            Past deliveries →
          </Text>
        </Card>
      </View>

      <SectionHeader title="Account" />
      <Card>
        <Row icon="call-outline" label="Mobile number" value={profile.phoneNumber ?? 'Not verified'} />
        <Row
          icon="car-outline"
          label="Vehicle"
          value={
            profile.vehicle
              ? `${VEHICLE_META[profile.vehicle.type].label} · ${profile.vehicle.plate}${profile.vehicle.model ? ` · ${profile.vehicle.model}` : ''}`
              : '—'
          }
        />
        <Row icon="mail-outline" label="Email" value={profile.email} />
      </Card>

      <SectionHeader title="Notifications" />
      <Card>
        <Row
          icon="chatbubble-ellipses-outline"
          label="Message alerts"
          value="Push notifications for new messages from dispatch"
          trailing={
            <Switch
              value={chatPush}
              onValueChange={(value) => void toggleChatPush(value)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          }
        />
        <Button
          label="Send a test notification"
          variant="secondary"
          icon="notifications-outline"
          loading={testing}
          onPress={sendTest}
        />
      </Card>

      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        loading={busy}
        onPress={() => void signOut()}
      />
      <Text variant="caption" color="subtle" align="center">
        InstaSupply Driver {appVersion}
        {env.useEmulators ? ' · local emulators' : ''}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', marginTop: 6 },
  flex: { flex: 1, gap: 2 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 16, marginTop: 8 },
  stat: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', gap: 10 },
});
