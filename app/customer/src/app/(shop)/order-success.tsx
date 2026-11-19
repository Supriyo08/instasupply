import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Header, Screen, Text } from '@/components/ui';
import { goShopping, singleParam } from '@/features/checkout/navigation';
import { OrderReceipt } from '@/features/checkout/OrderReceipt';
import { SuccessHero } from '@/features/checkout/SuccessHero';
import { useOrder } from '@/features/orders/hooks';

export default function OrderSuccessScreen() {
  const params = useLocalSearchParams<{ orderId?: string | string[]; number?: string | string[] }>();
  const orderId = singleParam(params.orderId);
  const number = singleParam(params.number) ?? null;
  const { data: order, loading } = useOrder(orderId);

  useEffect(() => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const trackOrder = () => {
    if (orderId) router.replace({ pathname: '/orders/[id]', params: { id: orderId } });
    else router.replace('/orders');
  };

  return (
    <Screen
      header={<Header title="Order Success" onBack={goShopping} />}
      contentStyle={styles.content}
      footer={
        <View style={styles.actions}>
          <Button label="Track order" icon="map-pin" onPress={trackOrder} />
          <Button label="Continue shopping" variant="secondary" onPress={goShopping} />
        </View>
      }
    >
      <View style={styles.body}>
        <SuccessHero />
        <View style={styles.copy}>
          <Text variant="title" align="center" accessibilityRole="header">
            Your order was successful!
          </Text>
          <Text color="muted" align="center" style={styles.message}>
            You will get a response within a few minutes.
          </Text>
        </View>
        <OrderReceipt number={number} order={order} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  body: { alignItems: 'center', flex: 1, gap: 24, justifyContent: 'center', paddingVertical: 12 },
  content: { flexGrow: 1 },
  copy: { alignItems: 'center', gap: 6 },
  message: { maxWidth: 260 },
});
