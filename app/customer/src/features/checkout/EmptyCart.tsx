import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState } from '@/components/ui';

import { goShopping } from './navigation';

/** Shown by the cart and the checkout steps when there is nothing to order. */
export function EmptyCart({
  message = 'Add studs, sheets, fasteners and more from stores near your jobsite. Every store delivers or has it ready for pickup.',
}: {
  message?: string;
}) {
  return (
    <View style={styles.center}>
      <EmptyState
        art="scene-empty-cart"
        title="Your cart is empty"
        message={message}
        action={
          <View style={styles.actions}>
            <Button label="Browse supplies" icon="search" onPress={goShopping} />
            <Button
              label="Send us your material list"
              variant="secondary"
              icon="file-text"
              onPress={() => router.push('/quotes/new')}
            />
          </View>
        }
      />
    </View>
  );
}

/** Pass as `contentStyle` so the empty state can centre itself in the scroll area. */
export const fillContent = { flexGrow: 1 } as const;

const styles = StyleSheet.create({
  actions: { gap: 10 },
  center: { flex: 1, justifyContent: 'center' },
});
