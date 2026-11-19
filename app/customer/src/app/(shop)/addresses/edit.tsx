import { useLocalSearchParams } from 'expo-router';

import { Button, EmptyState, ErrorState, Header, Screen } from '@/components/ui';
import { AddressEditor } from '@/features/account/address/AddressEditor';
import { AddressSkeleton } from '@/features/account/address/AddressSkeleton';
import { leaveTo } from '@/features/account/format';
import { useAddresses } from '@/features/addresses/hooks';
import { useCustomer } from '@/features/session/SessionProvider';

/**
 * Add (/addresses/edit) or edit (/addresses/edit?id=…) an address. With `returnTo=checkout`
 * the new address defaults to "Make default" and saving returns to checkout.
 */
export default function EditAddressScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id?: string; returnTo?: string }>();
  const { user, profile } = useCustomer();
  const addresses = useAddresses(user.uid);
  const existing = id ? (addresses.data.find((address) => address.id === id) ?? null) : null;

  if (addresses.loading || addresses.error || (id && !existing)) {
    return (
      <Screen header={<Header title={id ? 'Edit address' : 'Add address'} />}>
        {addresses.loading ? (
          <AddressSkeleton variant="form" />
        ) : addresses.error ? (
          <ErrorState
            title="Couldn't load your addresses"
            error={addresses.error}
            onRetry={addresses.retry}
          />
        ) : (
          <EmptyState
            art="scene-jobsite-delivery"
            title="Address not found"
            message="It may have been deleted on another device."
            action={
              <Button
                label="Back to my addresses"
                variant="secondary"
                onPress={() => leaveTo('/addresses')}
              />
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <AddressEditor
      key={existing?.id ?? 'new'}
      uid={user.uid}
      profile={profile}
      existing={existing}
      addresses={addresses.data}
      returnTo={returnTo}
    />
  );
}
