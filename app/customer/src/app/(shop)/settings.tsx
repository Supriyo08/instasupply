import { describeError } from '@instasupply/expo-firebase';
import type { UserPreferences } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Header, Screen, Text } from '@/components/ui';
import { PreferenceRow } from '@/features/account/PreferenceRow';
import { updatePreferences } from '@/features/account/profile-service';
import { PushPermissionNote } from '@/features/account/PushPermissionNote';
import { usePushPermission } from '@/features/account/usePushPermission';
import { useToast } from '@/features/notifications/ToastProvider';
import { useCustomer } from '@/features/session/SessionProvider';
import { notify } from '@/lib/notify';

type Choices = Required<Pick<UserPreferences, 'orderPush' | 'promoPush'>>;

/** Notification settings (Big Cart "Notifications"): push preferences saved on the profile. */
export default function NotificationSettingsScreen() {
  const { user, profile } = useCustomer();
  const toast = useToast();
  const permission = usePushPermission(user.uid);
  const [draft, setDraft] = useState<Partial<Choices>>({});
  const [saving, setSaving] = useState(false);

  // Both default to on, matching the backend (anything but an explicit `false` sends pushes).
  const saved: Choices = {
    orderPush: profile.preferences?.orderPush !== false,
    promoPush: profile.preferences?.promoPush !== false,
  };
  const values: Choices = { ...saved, ...draft };
  const dirty = values.orderPush !== saved.orderPush || values.promoPush !== saved.promoPush;

  const save = async () => {
    setSaving(true);
    try {
      await updatePreferences(user.uid, profile.preferences, values);
      setDraft({});
      toast({ title: 'Notification settings saved', icon: 'bell' });
    } catch (error) {
      notify("Couldn't save your settings", describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={<Header title="Notifications" />}
      footer={<Button label="Save settings" loading={saving} disabled={!dirty} onPress={() => void save()} />}
    >
      <Text variant="caption" color="muted" style={styles.intro}>
        Choose which push alerts we send to your phone. Order updates always stay in your in-app inbox.
      </Text>
      <PushPermissionNote status={permission.status} onEnable={() => void permission.enable()} />
      <PreferenceRow
        icon="truck"
        title="Order updates"
        description="Confirmation, out-for-delivery and delivered alerts for your orders."
        value={values.orderPush}
        onValueChange={(orderPush) => setDraft((current) => ({ ...current, orderPush }))}
        disabled={saving}
      />
      <PreferenceRow
        icon="tag"
        title="Offers & promotions"
        description="Deals, new arrivals and promo codes picked for you."
        value={values.promoPush}
        onValueChange={(promoPush) => setDraft((current) => ({ ...current, promoPush }))}
        disabled={saving}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ intro: { paddingHorizontal: 2 } });
