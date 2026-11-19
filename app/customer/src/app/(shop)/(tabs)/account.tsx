import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, Text } from '@/components/ui';
import { AccountStats } from '@/features/account/AccountStats';
import { MenuGroup, type MenuItem } from '@/features/account/MenuGroup';
import { ProfileHero } from '@/features/account/ProfileHero';
import { contactSupport } from '@/features/account/support';
import { useOrderCount } from '@/features/account/useOrderCount';
import { useSignOut } from '@/features/account/useSignOut';
import { useAddresses } from '@/features/addresses/hooks';
import { useFavorites } from '@/features/favorites/FavoritesProvider';
import { useNotifications } from '@/features/notifications/hooks';
import { useCustomer } from '@/features/session/SessionProvider';
import { appVersion } from '@/lib/env';
import { colors } from '@/theme/tokens';

/** Account tab (Big Cart "Account"): profile, quick stats and the menu. */
export default function AccountScreen() {
  const { user, profile } = useCustomer();
  const insets = useSafeAreaInsets();
  const favorites = useFavorites();
  const addresses = useAddresses(user.uid);
  const orderCount = useOrderCount(user.uid);
  const { unread } = useNotifications(user.uid);
  const { signOut, busy } = useSignOut(user.uid);

  const account: MenuItem[] = [
    { key: 'about', icon: 'user', label: 'About me', onPress: () => router.push('/about') },
    { key: 'orders', icon: 'package', label: 'My Orders', onPress: () => router.push('/orders') },
    { key: 'favorites', icon: 'heart', label: 'My Favorites', onPress: () => router.push('/favorites') },
    { key: 'addresses', icon: 'map-pin', label: 'My Address', onPress: () => router.push('/addresses') },
    { key: 'cards', icon: 'credit-card', label: 'Credit Cards', onPress: () => router.push('/cards') },
  ];
  const more: MenuItem[] = [
    {
      key: 'notifications',
      icon: 'bell',
      label: 'Notifications',
      count: unread,
      onPress: () => router.push('/notifications'),
    },
    {
      key: 'settings',
      icon: 'sliders',
      label: 'Notification settings',
      onPress: () => router.push('/settings'),
    },
    {
      key: 'help',
      icon: 'headphones',
      label: 'Help',
      value: 'Call us',
      onPress: () => void contactSupport(),
    },
  ];

  return (
    <Screen
      header={<View style={[styles.statusBar, { height: insets.top }]} />}
      contentStyle={styles.content}
    >
      <ProfileHero
        name={profile.displayName}
        email={profile.email ?? user.email}
        phone={profile.phoneNumber}
        phoneVerified={profile.phoneVerified}
        onEdit={() => router.push('/about')}
      />
      <AccountStats
        stats={[
          {
            key: 'orders',
            icon: 'package',
            label: 'Orders',
            value: orderCount,
            onPress: () => router.push('/orders'),
          },
          {
            key: 'favorites',
            icon: 'heart',
            label: 'Favorites',
            value: favorites.ready ? favorites.ids.length : null,
            onPress: () => router.push('/favorites'),
          },
          {
            key: 'addresses',
            icon: 'map-pin',
            label: 'Addresses',
            value: addresses.loading ? null : addresses.error ? Number.NaN : addresses.data.length,
            onPress: () => router.push('/addresses'),
          },
        ]}
      />
      <MenuGroup title="My account" items={account} />
      <MenuGroup title="Settings & support" items={more} />
      <MenuGroup
        items={[
          {
            key: 'sign-out',
            icon: 'log-out',
            label: 'Sign out',
            tone: 'danger',
            busy,
            onPress: () => void signOut(),
          },
        ]}
      />
      <Text variant="micro" color="subtle" align="center">
        InstaSupply · version {appVersion}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingTop: 0 },
  statusBar: { backgroundColor: colors.surface },
});
