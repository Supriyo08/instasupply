import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { Avatar } from './Avatar';
import { displayPhone } from './format';

/** Account tab header: avatar overlapping the white band, name, email and verified phone. */
export function ProfileHero({
  name,
  email,
  phone,
  phoneVerified,
  onEdit,
}: {
  name: string;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  onEdit: () => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.band} />
      <Avatar name={name} size={104} onEdit={onEdit} />
      <View style={styles.identity}>
        <Text variant="title" align="center" numberOfLines={1} accessibilityRole="header">
          {name}
        </Text>
        {email ? (
          <Text variant="caption" color="muted" align="center" numberOfLines={1}>
            {email}
          </Text>
        ) : null}
        {phone ? (
          <View
            style={styles.phone}
            accessible
            accessibilityLabel={`${displayPhone(phone)}${phoneVerified ? ', verified' : ''}`}
          >
            <Icon name={phoneVerified ? 'check-circle' : 'phone'} size={13} color={colors.primary} />
            <Text variant="captionMedium">{displayPhone(phone)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.surface,
    height: 72,
    left: -spacing.gutter,
    position: 'absolute',
    right: -spacing.gutter,
    top: 0,
  },
  hero: { alignItems: 'center', paddingTop: 20 },
  identity: { alignItems: 'center', gap: 2, marginTop: 12, maxWidth: '100%' },
  phone: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});
