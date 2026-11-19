import { describeError } from '@instasupply/expo-firebase';
import { formatAddress, type Address } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, EmptyState, ErrorState, Header, IconButton, Screen, Text } from '@/components/ui';
import { removeAddress } from '@/features/account/address/address-actions';
import { AddressCard, type AddressBusy } from '@/features/account/address/AddressCard';
import { AddressSkeleton } from '@/features/account/address/AddressSkeleton';
import { setDefaultAddress, useAddresses } from '@/features/addresses/hooks';
import { useToast } from '@/features/notifications/ToastProvider';
import { useCustomer } from '@/features/session/SessionProvider';
import { confirmAction, notify } from '@/lib/notify';

const addAddress = () => router.push('/addresses/edit');

/** "My Address": the address book, default first; tap a card for edit / default / delete. */
export default function AddressesScreen() {
  const { user } = useCustomer();
  const toast = useToast();
  const addresses = useAddresses(user.uid);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: NonNullable<AddressBusy> } | null>(null);
  const list = addresses.data;

  const makeDefault = async (address: Address) => {
    setBusy({ id: address.id, action: 'default' });
    try {
      await setDefaultAddress(user.uid, address.id, list);
      toast({
        title: 'Default address updated',
        body: `${address.label} is now used at checkout.`,
        icon: 'check-circle',
      });
    } catch (error) {
      notify("Couldn't update your default address", describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (address: Address) => {
    const confirmed = await confirmAction(
      'Delete this address?',
      `${address.label}: ${formatAddress(address)} will be removed from your address book.`,
      'Delete',
    );
    if (!confirmed) return;
    setBusy({ id: address.id, action: 'delete' });
    try {
      await removeAddress(user.uid, address, list);
      setExpanded(null);
      toast({ title: 'Address deleted', icon: 'trash-2' });
    } catch (error) {
      notify("Couldn't delete the address", describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const hasList = !addresses.loading && !addresses.error && list.length > 0;

  return (
    <Screen
      header={
        <Header
          title="My Address"
          right={<IconButton icon="plus-circle" label="Add address" onPress={addAddress} />}
        />
      }
      footer={hasList ? <Button label="Add new address" icon="plus" onPress={addAddress} /> : undefined}
    >
      {addresses.loading ? (
        <AddressSkeleton />
      ) : addresses.error ? (
        <ErrorState title="Couldn't load your addresses" error={addresses.error} onRetry={addresses.retry} />
      ) : list.length === 0 ? (
        <EmptyState
          art="scene-jobsite-delivery"
          title="No saved addresses"
          message="Add your delivery address once and we'll have it ready at checkout."
          action={<Button label="Add address" icon="plus" onPress={addAddress} />}
        />
      ) : (
        <>
          {list.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              expanded={expanded === address.id}
              busy={busy?.id === address.id ? busy.action : null}
              onToggle={() => setExpanded((current) => (current === address.id ? null : address.id))}
              onEdit={() => router.push({ pathname: '/addresses/edit', params: { id: address.id } })}
              onMakeDefault={() => void makeDefault(address)}
              onDelete={() => void remove(address)}
            />
          ))}
          <Text variant="caption" color="muted" align="center" style={styles.hint}>
            Your default address is selected automatically at checkout.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ hint: { paddingHorizontal: 12 } });
