import { describeError } from '@instasupply/expo-firebase';
import type { Role } from '@instasupply/shared';
import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { signOut } from '@/features/session/auth-service';
import { AccountCard } from '@/features/session/components/AccountCard';
import { StepHeading } from '@/features/session/components/StepHeading';
import { StepScreen } from '@/features/session/components/StepScreen';
import { useSession } from '@/features/session/SessionProvider';
import { notify } from '@/lib/notify';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  customer: 'Customer',
};

/** A driver or staff login opened the shopping app; explain and offer to sign out. */
export default function WrongAccountScreen() {
  const { user, profile, claims } = useSession();
  const [busy, setBusy] = useState(false);
  const role = claims.role ?? profile?.role ?? null;
  const isDriver = role === 'driver';

  const leave = async () => {
    setBusy(true);
    try {
      await signOut();
      // The router returns to the welcome screen once signed out.
    } catch (error) {
      notify('Could not sign out', describeError(error));
      setBusy(false);
    }
  };

  return (
    <StepScreen
      title="Wrong account"
      back={false}
      footer={<Button label="Sign out" icon="log-out" loading={busy} onPress={() => void leave()} />}
    >
      <StepHeading
        icon={isDriver ? 'truck' : 'briefcase'}
        title={isDriver ? 'This is a driver account' : 'This is a staff account'}
        subtitle={
          isDriver
            ? "Driver logins deliver orders in the InstaSupply Driver app, so they can't be used for shopping."
            : "Staff logins manage deliveries in the InstaSupply back office, so they can't be used for shopping."
        }
      />
      <AccountCard
        name={profile?.displayName ?? user?.displayName ?? null}
        email={user?.email ?? null}
        role={role ? ROLE_LABEL[role] : 'Staff'}
      />
      <Notice
        tone="info"
        title="Want to shop with us?"
        message="Sign out, then log in with your customer account or create one with a different email address."
      />
    </StepScreen>
  );
}
