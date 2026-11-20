import { useConfig } from '@instasupply/api-client/react';

import { Button, EmptyState, Screen } from '@/components/ui';
import { acknowledgeSessionEnd, signOut } from '@/features/auth/auth-service';
import { useSession, type SessionStatus } from '@/features/auth/SessionProvider';
import { callPhone } from '@/lib/links';

type Notice = {
  icon: 'briefcase-outline' | 'cart-outline' | 'storefront-outline' | 'lock-closed-outline';
  title: string;
  message: string;
};

const NOTICES: Partial<Record<SessionStatus, Notice>> = {
  staff_account: {
    icon: 'briefcase-outline',
    title: 'This is an InstaSupply staff account',
    message: 'Use the InstaSupply console on the web. To drive with us, sign in here with a driver account.',
  },
  shopper_account: {
    icon: 'cart-outline',
    title: 'This is a customer account',
    message: 'Order materials in the InstaSupply app. To drive with us, sign up here with a different email.',
  },
  supplier_account: {
    icon: 'storefront-outline',
    title: 'This is a supplier account',
    message:
      'Manage your store in the InstaSupply portal on the web. To drive with us, use a different email.',
  },
};

/** Suspended drivers and staff, customer or supplier accounts that opened the driver app (CLIENTS §2.3). */
export default function AccountNotice() {
  const { status, profile, user } = useSession();
  const config = useConfig();
  const notice = NOTICES[status];
  const supportPhone = config?.supportPhone ?? null;
  // Suspended with no session left (the server ended it): "Back to sign in" forgets the reason.
  const signedOut = status === 'suspended' && !user;
  return (
    <Screen>
      <EmptyState
        icon={notice?.icon ?? 'lock-closed-outline'}
        title={notice?.title ?? 'Your account is suspended'}
        message={
          notice?.message ??
          profile?.suspendedReason ??
          'Your account is suspended. Contact InstaSupply support to reactivate it.'
        }
      />
      {!notice && supportPhone ? (
        <Button
          label="Call InstaSupply"
          icon="call"
          variant="secondary"
          onPress={() => void callPhone(supportPhone)}
        />
      ) : null}
      {signedOut ? (
        <Button label="Back to sign in" onPress={acknowledgeSessionEnd} />
      ) : (
        <Button label="Sign out" onPress={() => void signOut()} />
      )}
    </Screen>
  );
}
