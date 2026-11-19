import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import { env } from '@/lib/env';
import { callPhone } from '@/lib/links';
import { notify } from '@/lib/notify';
import { colors, gradient, shadows, spacing } from '@/theme/tokens';

/** "Need help?" row that calls the support line (EXPO_PUBLIC_SUPPORT_PHONE). Hidden when none is set. */
export function SupportCard({ orderNumber }: { orderNumber: string }) {
  const phone = env.supportPhone;
  if (!phone) return null;

  const call = async () => {
    try {
      await callPhone(phone);
    } catch {
      notify('Call support', `Call us on ${phone} and mention order ${orderNumber}.`);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.icon}>
        <Icon name="headphones" size={22} color={colors.primary} />
      </View>
      <View style={styles.text}>
        <Text variant="heading">Need help?</Text>
        <Text variant="caption" color="muted">
          Questions about order {orderNumber}? Call us on {phone}.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Call support on ${phone}`}
        hitSlop={6}
        onPress={() => void call()}
        style={({ pressed }) => [styles.call, shadows.brand, pressed ? styles.pressed : null]}
      >
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={styles.callFill}
        >
          <Icon name="phone" size={18} color={colors.white} />
        </LinearGradient>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  call: { borderRadius: 22 },
  callFill: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  card: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  text: { flex: 1, gap: 1 },
});
