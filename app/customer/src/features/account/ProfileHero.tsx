import type { AccountType } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { Avatar } from './Avatar';
import { displayPhone } from './format';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  contractor: 'Contractor',
  renovator: 'Renovator',
  builder: 'Builder',
  homeowner: 'Homeowner',
};

/** Account tab header: photo or initials, name, company and account type, email and phone. */
export function ProfileHero({
  name,
  email,
  phone,
  phoneVerified,
  companyName,
  accountType,
  photoUrl,
  onEdit,
}: {
  name: string;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  companyName: string | null;
  accountType: AccountType | null;
  photoUrl: string | null;
  onEdit: () => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.band} />
      <Avatar name={name} size={104} uri={photoUrl} onEdit={onEdit} />
      <View style={styles.identity}>
        <Text variant="title" align="center" numberOfLines={1} accessibilityRole="header">
          {name}
        </Text>
        {companyName || accountType ? (
          <View style={styles.company}>
            {companyName ? (
              <Text variant="bodyMedium" color="muted" numberOfLines={1}>
                {companyName}
              </Text>
            ) : null}
            {accountType ? <Badge label={ACCOUNT_TYPE_LABEL[accountType]} tone="brand" /> : null}
          </View>
        ) : null}
        {email ? (
          <Text variant="caption" color="muted" align="center" numberOfLines={1}>
            {email}
          </Text>
        ) : null}
        {phone ? (
          <View
            style={styles.phone}
            accessible
            accessibilityLabel={`${displayPhone(phone)}${phoneVerified ? ', verified' : ', not verified'}`}
          >
            <Icon name={phoneVerified ? 'check-circle' : 'phone'} size={13} color={colors.primaryDark} />
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
  company: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
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
