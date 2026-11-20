import { initials } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtImage, Icon, IconButton, Text, webColumn } from '@/components/ui';
import { useNotifications } from '@/features/notifications/hooks';
import { useSession, useUid } from '@/features/session/SessionProvider';
import { useSite } from '@/features/site/SiteProvider';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * Home's white top band: avatar, the jobsite switcher "Deliver to · Leslieville semi reno ▾" (opens
 * the site sheet) and the inbox bell, then the search bar.
 */
export function HomeHeader() {
  const insets = useSafeAreaInsets();
  const uid = useUid();
  const { profile } = useSession();
  const { site, ready } = useSite();
  const { unread } = useNotifications(uid);
  const siteLabel = site?.label ?? (ready ? 'Choose a jobsite' : '…');

  return (
    <View style={[styles.band, { paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.column, webColumn]}>
        <View style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={profile ? 'Account' : 'Sign in'}
            onPress={() => router.push('/account')}
            style={styles.avatar}
          >
            {profile?.photoURL ? (
              <ArtImage uri={profile.photoURL} size={40} style={styles.photo} />
            ) : profile ? (
              <Text variant="captionMedium" color="primaryDark">
                {initials(profile.displayName)}
              </Text>
            ) : (
              <Icon name="user" size={18} color={colors.primaryDark} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Deliver to ${siteLabel}. Change jobsite`}
            onPress={() => router.push('/site')}
            style={({ pressed }) => [styles.switcher, pressed ? styles.pressed : null]}
          >
            <Text variant="micro" color="muted">
              Deliver to
            </Text>
            <View style={styles.siteRow}>
              <Icon name="map-pin" size={14} color={colors.primaryDark} />
              <Text variant="bodyMedium" numberOfLines={1} style={styles.siteLabel}>
                {siteLabel}
              </Text>
              <Icon name="chevron-down" size={16} color={colors.text} />
            </View>
          </Pressable>
          {uid ? (
            <IconButton
              icon="bell"
              label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              badge={unread}
              onPress={() => router.push('/notifications')}
            />
          ) : null}
        </View>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search products"
          accessibilityHint="Search 2x4, drywall, PEX and more across nearby stores"
          onPress={() => router.push('/search')}
          style={({ pressed }) => [styles.search, pressed ? styles.pressed : null]}
        >
          <Icon name="search" size={20} color={colors.textMuted} />
          <Text color="muted" numberOfLines={1}>
            Search 2x4, drywall, PEX…
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 40,
  },
  band: { backgroundColor: colors.surface, paddingBottom: spacing.lg },
  column: { gap: spacing.md, paddingHorizontal: spacing.gutter },
  photo: { borderRadius: 20 },
  pressed: { opacity: 0.7 },
  search: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  siteLabel: { flexShrink: 1 },
  siteRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  switcher: { flex: 1, gap: 0 },
  top: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
