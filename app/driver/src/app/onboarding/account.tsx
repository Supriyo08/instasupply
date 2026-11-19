import { Button, EmptyState, Screen } from '@/components/ui';
import { signOut } from '@/features/auth/auth-service';
import { useSession, type SessionStatus } from '@/features/auth/SessionProvider';
import { env } from '@/lib/env';
import { callPhone } from '@/lib/links';

type Notice = {
  icon: 'briefcase-outline' | 'basket-outline' | 'lock-closed-outline';
  title: string;
  message: string;
};

const NOTICES: Partial<Record<SessionStatus, Notice>> = {
  staff_account: {
    icon: 'briefcase-outline',
    title: 'This is a dispatch account',
    message:
      'Use the InstaSupply back office on the web to manage deliveries. Sign in here with a driver account.',
  },
  shopper_account: {
    icon: 'basket-outline',
    title: 'This is a shopper account',
    message:
      'Use the InstaSupply shopping app to order groceries. To deliver with us, sign up here with a different email.',
  },
};

/** Shown for suspended drivers and for staff or shopper accounts that opened the driver app. */
export default function AccountNotice() {
  const { status, profile } = useSession();
  const notice = NOTICES[status];
  return (
    <Screen>
      <EmptyState
        icon={notice?.icon ?? 'lock-closed-outline'}
        title={notice?.title ?? 'Your account is suspended'}
        message={
          notice?.message ??
          profile?.suspendedReason ??
          'Please contact your dispatcher to reactivate your account.'
        }
      />
      {!notice && env.dispatchPhone ? (
        <Button
          label="Call dispatch"
          icon="call"
          variant="secondary"
          onPress={() => void callPhone(env.dispatchPhone!)}
        />
      ) : null}
      <Button label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
