import { initials } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const AVATAR = 46;

/** The signed-in account: initials avatar, name, email and role badge. */
export function AccountCard({
  name,
  email,
  role,
}: {
  name: string | null;
  email: string | null;
  role: string;
}) {
  return (
    <Card
      style={styles.card}
      accessibilityLabel={`Signed in as ${name ?? email ?? 'this account'}, ${role} account`}
    >
      <View style={styles.avatar}>
        <Text variant="subheading" style={{ color: colors.primaryDark }}>
          {initials(name || email)}
        </Text>
      </View>
      <View style={styles.info}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {name || 'Signed-in account'}
        </Text>
        {email ? (
          <Text variant="caption" color="muted" numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
      <Badge label={role} tone="info" />
    </Card>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: AVATAR / 2,
    height: AVATAR,
    justifyContent: 'center',
    width: AVATAR,
  },
  card: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  info: { flex: 1, gap: 1 },
});
