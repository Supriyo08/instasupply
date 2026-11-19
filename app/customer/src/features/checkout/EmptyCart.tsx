import { StyleSheet, View } from 'react-native';

import { Button, EmptyState } from '@/components/ui';

import { goShopping } from './navigation';

/** Shown by the cart and the checkout steps when there is nothing to buy. */
export function EmptyCart({
  message = "Looks like you haven't added anything yet. Fresh fruit, veggies and daily essentials are a tap away.",
}: {
  message?: string;
}) {
  return (
    <View style={styles.center}>
      <EmptyState
        art="scene-empty-cart"
        title="Your cart is empty"
        message={message}
        action={<Button label="Start shopping" icon="shopping-bag" onPress={goShopping} />}
      />
    </View>
  );
}

/** Pass as `contentStyle` so the empty state can centre itself in the scroll area. */
export const fillContent = { flexGrow: 1 } as const;

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
});
