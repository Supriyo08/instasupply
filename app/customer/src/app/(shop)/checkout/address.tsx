import { describeError } from '@instasupply/expo-firebase';
import { pluralize, type Address } from '@instasupply/shared';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, Header, Notice, Screen, Text } from '@/components/ui';
import { useAddresses } from '@/features/addresses/hooks';
import { useCart } from '@/features/cart/CartProvider';
import { useCartDetails } from '@/features/cart/useCartDetails';
import { AddOptionButton } from '@/features/checkout/AddOptionButton';
import { AddressOption } from '@/features/checkout/AddressOption';
import { CartErrorNotice } from '@/features/checkout/CartErrorNotice';
import { EmptyCart, fillContent } from '@/features/checkout/EmptyCart';
import { reviewCart } from '@/features/checkout/navigation';
import { OptionCardsSkeleton } from '@/features/checkout/Skeletons';
import { StepProgress } from '@/features/checkout/StepProgress';
import { useChoice } from '@/features/checkout/useChoice';
import { useCustomer } from '@/features/session/SessionProvider';

export default function ShippingAddressScreen() {
  const { user } = useCustomer();
  const cart = useCart();
  const { loading: cartLoading, error: cartError, retry: retryCart, canCheckout } = useCartDetails(user.uid);
  const addresses = useAddresses(user.uid);
  const { defaultAddress } = addresses;
  const choice = useChoice<Address>(addresses.data, () => defaultAddress);
  const header = <Header title="Shipping Address" />;

  if (cart.lines.length === 0) {
    return (
      <Screen header={header} contentStyle={fillContent}>
        <EmptyCart message="Add something to your cart before choosing where to deliver it." />
      </Screen>
    );
  }

  const selected = choice.selected;
  const addNew = () => {
    choice.beginAdd();
    router.push({ pathname: '/addresses/edit', params: { returnTo: 'checkout' } });
  };
  const loadingList = addresses.loading && addresses.data.length === 0;
  const noAddresses = !loadingList && !addresses.error && addresses.data.length === 0;

  let list: ReactNode;
  if (loadingList) {
    list = <OptionCardsSkeleton label="Loading your addresses" />;
  } else if (addresses.error) {
    list = (
      <Notice
        tone="danger"
        title="Couldn't load your addresses"
        message={describeError(addresses.error, 'Check your connection and try again.')}
        actionLabel="Try again"
        onAction={addresses.retry}
      />
    );
  } else if (noAddresses) {
    list = (
      <EmptyState
        art="scene-jobsite-delivery"
        title="Where should we deliver?"
        message="Add your first delivery address to continue with your order."
      />
    );
  } else {
    list = (
      <View accessibilityRole="radiogroup" accessibilityLabel="Saved addresses" style={styles.list}>
        {addresses.data.map((address) => (
          <AddressOption
            key={address.id}
            address={address}
            selected={address.id === selected?.id}
            onSelect={choice.choose}
          />
        ))}
      </View>
    );
  }

  const footer = noAddresses ? (
    <Button label="Add new address" icon="plus" onPress={addNew} />
  ) : (
    <Button
      label="Continue"
      disabled={!selected || !canCheckout}
      onPress={() => {
        if (selected) router.push({ pathname: '/checkout/payment', params: { addressId: selected.id } });
      }}
    />
  );

  return (
    <Screen header={header} footer={footer}>
      <StepProgress current={1} />

      {cartError ? (
        <CartErrorNotice error={cartError} onRetry={retryCart} />
      ) : !cartLoading && !canCheckout ? (
        <Notice
          tone="warning"
          title="Your cart needs attention"
          message="Some items sold out or changed. Review your cart to continue."
          actionLabel="Review"
          onAction={reviewCart}
        />
      ) : null}

      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text variant="heading">Deliver to</Text>
          {addresses.data.length > 0 ? (
            <Text variant="caption" color="muted">
              {pluralize(addresses.data.length, 'saved address', 'saved addresses')}
            </Text>
          ) : null}
        </View>
        {list}
      </View>

      {noAddresses ? null : <AddOptionButton label="Add new address" onPress={addNew} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  section: { gap: 12 },
  titleRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
});
