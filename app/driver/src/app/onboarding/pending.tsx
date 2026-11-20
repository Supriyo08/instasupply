import { formatPhone } from '@instasupply/shared';
import { useConfig } from '@instasupply/api-client/react';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Icon, Screen, Text } from '@/components/ui';
import { signOut } from '@/features/auth/auth-service';
import { requiresPhone, useSession } from '@/features/auth/SessionProvider';
import { StepHeader } from '@/features/auth/StepHeader';
import { usePushPermission } from '@/features/notifications/usePushPermission';
import { ONBOARDING_STEPS } from '@/features/vehicle/onboarding-steps';
import { useTheme } from '@/theme/ThemeProvider';

function Check({ done, label }: { done: boolean; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.check}>
      <Icon
        name={done ? 'checkmark-circle' : 'time-outline'}
        size={22}
        color={done ? colors.success : colors.warning}
      />
      <Text>{label}</Text>
    </View>
  );
}

/**
 * Waits for ops to approve the driver (MARKETPLACE §10); the session advances by itself when they do.
 * It asks for push permission here, with a reason first, so the "You're approved" push has a device to
 * reach (code review R59): `PushRegistrar` never prompts and `(app)` is not reached before approval.
 */
export default function PendingStep() {
  const { profile } = useSession();
  const config = useConfig();
  const push = usePushPermission();
  const [enabling, setEnabling] = useState(false);
  const phoneStep = config ? requiresPhone(config) : false;
  const phoneVerified = profile?.phoneVerified === true;

  const enable = () => {
    setEnabling(true);
    void push.enable().finally(() => setEnabling(false));
  };

  const promise =
    push.status === 'granted'
      ? "Approvals usually take less than a day. We'll send you a notification as soon as you're active."
      : 'Approvals usually take less than a day. Open the app to check: this screen changes as soon as you’re active.';

  return (
    <Screen>
      <StepHeader
        step={ONBOARDING_STEPS.pending}
        total={ONBOARDING_STEPS.total}
        title="Almost there"
        subtitle="We'll call to confirm your licence, insurance and payout setup."
      />
      <Card>
        <View style={styles.list}>
          <Check done label="Account created" />
          <Check done label={`Vehicle added${profile?.vehicle ? ` · ${profile.vehicle.plate}` : ''}`} />
          {phoneVerified || phoneStep ? (
            <Check
              done={phoneVerified}
              label={`Phone verified${phoneVerified && profile?.phoneNumber ? ` · ${formatPhone(profile.phoneNumber)}` : ''}`}
            />
          ) : null}
          <Check done={false} label="Call from InstaSupply ops and approval" />
        </View>
      </Card>

      {push.status === 'ask' ? (
        <View style={styles.note}>
          <Banner
            tone="info"
            title="Get told when you're approved"
            message="Allow notifications and we'll tell you the moment you can take jobs. Job offers and dispatch messages arrive the same way."
          />
          <Button
            label="Allow notifications"
            icon="notifications-outline"
            loading={enabling}
            onPress={enable}
          />
        </View>
      ) : null}
      {push.status === 'blocked' ? (
        <View style={styles.note}>
          <Banner
            tone="warning"
            title="Notifications are off for InstaSupply"
            message="Turn them on in your phone's settings to hear when you're approved and when jobs come in."
          />
          <Button
            label="Open settings"
            variant="secondary"
            icon="settings-outline"
            onPress={() => void Linking.openSettings()}
          />
        </View>
      ) : null}

      <Text variant="caption" color="subtle" align="center">
        {promise}
      </Text>
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  check: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  list: { gap: 14 },
  note: { gap: 8 },
});
