import { firstName } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, Skeleton, Text } from '@/components/ui';
import { useAddresses } from '@/features/addresses/hooks';
import { useNotifications } from '@/features/notifications/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

/** Greeting + delivery address (opens the address book) and the notifications bell. */
export function HomeTopBar({ uid, name }: { uid: string; name: string }) {
  const { defaultAddress, loading } = useAddresses(uid);
  const { unread } = useNotifications(uid);
  const place = defaultAddress ? `${defaultAddress.line1}, ${defaultAddress.city}` : null;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          defaultAddress ? `Delivering to ${defaultAddress.label}, ${place}` : 'Add a delivery address'
        }
        accessibilityHint="Opens your saved addresses"
        onPress={() => router.push('/addresses')}
        style={({ pressed }) => [styles.location, pressed ? styles.pressed : null]}
      >
        <View style={styles.pin}>
          <Icon name="map-pin" size={18} color={colors.primary} />
        </View>
        <View style={styles.text}>
          <Text variant="caption" color="muted" numberOfLines={1}>
            Hello, {firstName(name)}
          </Text>
          {loading ? (
            <Skeleton style={styles.lineSkeleton} />
          ) : (
            <View style={styles.addressRow}>
              <Text variant="bodyMedium" numberOfLines={1} style={styles.address}>
                {defaultAddress ? (
                  <>
                    <Text variant="bodyMedium" color="primary">
                      {defaultAddress.label}
                    </Text>
                    {` · ${place}`}
                  </>
                ) : (
                  'Add a delivery address'
                )}
              </Text>
              <Icon name="chevron-down" size={16} color={colors.text} />
            </View>
          )}
        </View>
      </Pressable>
      <IconButton
        icon="bell"
        label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        badge={unread}
        background={colors.surface}
        onPress={() => router.push('/notifications')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  address: { flexShrink: 1 },
  addressRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  lineSkeleton: { height: 14, marginTop: 4, width: 150 },
  location: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.md },
  pin: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: { opacity: 0.7 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  text: { flex: 1 },
});
