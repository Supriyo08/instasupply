import { describeError } from '@instasupply/api-client';
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
  supplier: 'Supplier',
};

/** A driver, supplier or staff login opened the customer app; explain and offer to sign out. */
export default function WrongAccountScreen() {
  const { user, profile } = useSession();
  const [busy, setBusy] = useState(false);
  const role = profile?.role ?? null;
  const isDriver = role === 'driver';
  const isSupplier = role === 'supplier';

  const leave = async () => {
    setBusy(true);
    try {
      await signOut();
      // The router returns to the shop as a guest once signed out.
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
        icon={isDriver ? 'truck' : isSupplier ? 'home' : 'briefcase'}
        title={
          isDriver
            ? 'This is a driver account'
            : isSupplier
              ? 'This is a supplier account'
              : 'This is a staff account'
        }
        subtitle={
          isDriver
            ? "Driver logins deliver orders in the InstaSupply Driver app, so they can't be used to order."
            : isSupplier
              ? "Supplier logins run your store in the InstaSupply web portal, so they can't be used to order."
              : "Staff logins work in the InstaSupply console, so they can't be used to order."
        }
      />
      <AccountCard
        name={profile?.displayName ?? user?.displayName ?? null}
        email={user?.email ?? null}
        role={role ? ROLE_LABEL[role] : 'Staff'}
      />
      <Notice
        tone="info"
        title="Want to order supplies?"
        message="Sign out, then log in with your customer account or create one with a different email address."
      />
    </StepScreen>
  );
}
