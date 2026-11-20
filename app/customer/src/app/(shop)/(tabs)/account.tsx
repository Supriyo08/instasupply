import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtImage, Button, Card, Screen, Text } from '@/components/ui';
import { EditProfileSheet } from '@/features/account/EditProfileSheet';
import { MenuGroup, type MenuItem } from '@/features/account/MenuGroup';
import { ProfileHero } from '@/features/account/ProfileHero';
import { useSignOut } from '@/features/account/useSignOut';
import { useNotifications } from '@/features/notifications/hooks';
import { goToSignIn } from '@/features/session/RequireAccount';
import { useSession, useUid } from '@/features/session/SessionProvider';
import { useSupportSummary } from '@/features/support/hooks';
import { appVersion } from '@/lib/env';
import { colors, radius, spacing } from '@/theme/tokens';

const go = (href: Href) => () => router.push(href);

/** Rows guests see too (MARKETPLACE §7.3 account row). */
const PUBLIC_ROWS: MenuItem[] = [
  { key: 'suggest', icon: 'plus-square', label: 'Suggest a store', onPress: go('/suggest-store') },
  { key: 'help', icon: 'help-circle', label: 'Help & FAQ', onPress: go('/help') },
  { key: 'about', icon: 'info', label: 'About', onPress: go('/about') },
];

/**
 * Account tab (MARKETPLACE §7.3): profile (name, company, account type, phone, photo), the menu and
 * sign-out. Guests get a sign-in card with Suggest a store, Help and About.
 */
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { profile, user } = useSession();
  const uid = useUid();
  const { unread } = useNotifications(uid);
  const thread = useSupportSummary(uid);
  const { signOut, busy } = useSignOut();
  const [editing, setEditing] = useState(false);

  const header = <View style={[styles.statusBar, { height: insets.top }]} />;
  const footer = (
    <Text variant="micro" color="subtle" align="center">
      InstaSupply · version {appVersion}
    </Text>
  );

  if (!uid || !profile) {
    return (
      <Screen header={header} contentStyle={styles.content}>
        <Card style={styles.signIn}>
          <View style={styles.art}>
            <ArtImage artKey="scene-welcome" width={180} height={130} />
          </View>
          <Text variant="heading">Sign in to order</Text>
          <Text color="muted">Track deliveries and keep your jobsites, cards, saved items and quotes.</Text>
          <Button label="Sign in" onPress={() => goToSignIn('/account')} />
          <Button
            label="Create account"
            variant="secondary"
            onPress={() => goToSignIn('/account', 'signup')}
          />
        </Card>
        <MenuGroup items={PUBLIC_ROWS} />
        {footer}
      </Screen>
    );
  }

  const account: MenuItem[] = [
    { key: 'jobsites', icon: 'map-pin', label: 'Jobsites', onPress: go('/jobsites') },
    { key: 'cards', icon: 'credit-card', label: 'Payment cards', onPress: go('/cards') },
    { key: 'saved', icon: 'heart', label: 'Saved items', onPress: go('/saved') },
    { key: 'quotes', icon: 'clipboard', label: 'Material lists & quotes', onPress: go('/quotes') },
  ];
  const more: MenuItem[] = [
    {
      key: 'notifications',
      icon: 'bell',
      label: 'Notifications',
      count: unread,
      onPress: go('/notifications'),
    },
    {
      key: 'support',
      icon: 'message-circle',
      label: 'Support chat',
      count: thread.data?.unreadByOwner ?? 0,
      onPress: go('/support'),
    },
    { key: 'settings', icon: 'sliders', label: 'Settings', onPress: go('/settings') },
    ...PUBLIC_ROWS,
  ];

  return (
    <Screen header={header} contentStyle={styles.content}>
      <ProfileHero
        name={profile.displayName}
        email={profile.email ?? user?.email ?? null}
        phone={profile.phoneNumber}
        phoneVerified={profile.phoneVerified}
        companyName={profile.companyName ?? null}
        accountType={profile.accountType ?? null}
        photoUrl={profile.photoURL ?? null}
        onEdit={() => setEditing(true)}
      />
      <Button
        label="Edit profile"
        icon="edit-2"
        variant="secondary"
        size="md"
        onPress={() => setEditing(true)}
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
      {footer}
      <EditProfileSheet visible={editing} profile={profile} onClose={() => setEditing(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    height: 150,
    justifyContent: 'center',
    width: 150,
  },
  content: { gap: spacing.xl, paddingTop: 0 },
  signIn: { gap: spacing.md, marginTop: spacing.lg },
  statusBar: { backgroundColor: colors.surface },
});
