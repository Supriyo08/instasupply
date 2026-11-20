import { describeError } from '@instasupply/api-client';
import { PUSH_PREFERENCE_DEFAULTS, type UserPreferences } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Header, Screen, Text } from '@/components/ui';
import { FormSection } from '@/features/account/FormSection';
import { PasswordResetCard } from '@/features/account/PasswordResetCard';
import { PreferenceRow } from '@/features/account/PreferenceRow';
import { updatePreferences } from '@/features/account/profile-service';
import { PushPermissionNote } from '@/features/account/PushPermissionNote';
import { usePushPermission } from '@/features/account/usePushPermission';
import { useToast } from '@/features/notifications/ToastProvider';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { notify } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

type Key = 'orderPush' | 'promoPush' | 'chatPush';

const ROWS: { key: Key; icon: 'truck' | 'tag' | 'message-circle'; title: string; description: string }[] = [
  {
    key: 'orderPush',
    icon: 'truck',
    title: 'Order updates',
    description: 'Store confirmations, shortages, pickup PINs, the truck on its way and delivery photos.',
  },
  {
    key: 'chatPush',
    icon: 'message-circle',
    title: 'Support chat',
    description: 'Replies from the InstaSupply team.',
  },
  {
    key: 'promoPush',
    icon: 'tag',
    title: 'Deals and offers',
    description: 'Promo codes and supplier offers. Only if you opt in; turn it off any time.',
  },
];

/** Settings 🔒 (MARKETPLACE §7.3): order updates, deals (opt-in) and chat; push state (CLIENTS §6.2). */
export default function SettingsScreen() {
  return (
    <RequireAccount title="Settings">
      <SettingsBody />
    </RequireAccount>
  );
}

function SettingsBody() {
  const { profile } = useCustomer();
  const toast = useToast();
  const permission = usePushPermission();
  const [pending, setPending] = useState<Partial<Record<Key, boolean>>>({});

  const valueOf = (key: Key) => pending[key] ?? profile.preferences?.[key] ?? PUSH_PREFERENCE_DEFAULTS[key];

  const change = async (key: Key, value: boolean) => {
    setPending((current) => ({ ...current, [key]: value }));
    try {
      const changes: Partial<UserPreferences> = { [key]: value };
      await updatePreferences(changes);
      toast({
        title: 'Saved',
        body: value ? 'You will get these alerts.' : 'These alerts are off.',
        icon: 'check',
      });
    } catch (error) {
      notify("Couldn't save your settings", describeError(error));
    } finally {
      // The session profile now holds the saved value (or the old one after a failure).
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <Screen header={<Header title="Settings" />} contentStyle={styles.content}>
      <Text variant="caption" color="muted" style={styles.intro}>
        Choose which push alerts we send to this phone. Everything also stays in your notification inbox.
      </Text>
      <PushPermissionNote status={permission.status} onEnable={() => void permission.enable()} />
      {ROWS.map((row) => (
        <PreferenceRow
          key={row.key}
          icon={row.icon}
          title={row.title}
          description={row.description}
          value={valueOf(row.key)}
          disabled={pending[row.key] !== undefined}
          onValueChange={(value) => void change(row.key, value)}
        />
      ))}
      <Button
        label="Open the inbox"
        icon="bell"
        variant="secondary"
        onPress={() => router.push('/notifications')}
      />
      <FormSection title="Password">
        <PasswordResetCard />
      </FormSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  intro: { paddingHorizontal: 2 },
});
