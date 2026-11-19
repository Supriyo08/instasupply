import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Screen, Text } from '@/components/ui';
import { signOut } from '@/features/auth/auth-service';
import { useSession } from '@/features/auth/SessionProvider';
import { StepHeader } from '@/features/auth/StepHeader';
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

/** Waits for an admin to approve the driver; the session advances automatically when they do. */
export default function PendingStep() {
  const { profile } = useSession();
  return (
    <Screen>
      <StepHeader
        step={4}
        total={4}
        title="Almost there"
        subtitle="An admin is reviewing your account. This screen updates by itself once you're approved."
      />
      <Card>
        <View style={styles.list}>
          <Check done label="Account created" />
          <Check done label={`Vehicle added${profile?.vehicle ? ` · ${profile.vehicle.plate}` : ''}`} />
          <Check done label={`Phone verified${profile?.phoneNumber ? ` · ${profile.phoneNumber}` : ''}`} />
          <Check done={false} label="Approval by dispatch" />
        </View>
      </Card>
      <Text variant="caption" color="subtle" align="center">
        Approvals usually take less than a day. We'll notify you as soon as you're active.
      </Text>
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  check: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  list: { gap: 14 },
});
