import { VEHICLE_CLASSES, formatPhone, type Jobsite } from '@instasupply/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { jobsiteAddress, lastUsedLabel } from './jobsite-form';

export type JobsiteBusy = 'default' | 'delete' | null;

function Action({
  label,
  icon,
  danger,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon: 'check-circle' | 'edit-2' | 'trash-2';
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const tint = danger ? colors.danger : colors.primaryDark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed || disabled ? styles.dim : null]}
    >
      <Icon name={icon} size={14} color={tint} />
      <Text variant="captionMedium" style={{ color: tint }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A saved jobsite: name, badges (default, last used), address, contact, receiving, vehicle limit and actions. */
export function JobsiteCard({
  jobsite,
  now,
  busy,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  jobsite: Jobsite;
  now: number;
  busy: JobsiteBusy;
  onEdit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const used = lastUsedLabel(jobsite, now);
  const details = [
    jobsite.receiving === 'attended' ? 'Someone on site' : 'Leave at site',
    jobsite.maxVehicleClass ? `${VEHICLE_CLASSES[jobsite.maxVehicleClass].label} max` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${jobsite.label}, ${jobsiteAddress(jobsite)}`}
        onPress={onEdit}
        style={styles.main}
      >
        <View style={styles.pin}>
          <Icon name="map-pin" size={18} color={colors.primaryDark} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="heading" numberOfLines={1} style={styles.title}>
              {jobsite.label}
            </Text>
            {jobsite.isDefault ? <Badge label="Default" tone="success" /> : null}
          </View>
          <Text variant="caption" color="muted">
            {jobsiteAddress(jobsite)}
          </Text>
          <Text variant="caption" color="muted">
            {jobsite.contactName} · {formatPhone(jobsite.contactPhone)}
          </Text>
          <Text variant="caption" color="muted">
            {details}
          </Text>
          {used ? (
            <Text variant="micro" color="subtle">
              {used}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        {!jobsite.isDefault ? (
          <Action
            label={busy === 'default' ? 'Saving…' : 'Make default'}
            icon="check-circle"
            disabled={busy != null}
            onPress={onMakeDefault}
            accessibilityLabel={`Make ${jobsite.label} the default jobsite`}
          />
        ) : null}
        <Action
          label="Edit"
          icon="edit-2"
          disabled={busy != null}
          onPress={onEdit}
          accessibilityLabel={`Edit ${jobsite.label}`}
        />
        <Action
          label={busy === 'delete' ? 'Deleting…' : 'Delete'}
          icon="trash-2"
          danger
          disabled={busy != null}
          onPress={onDelete}
          accessibilityLabel={`Delete ${jobsite.label}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.lg, justifyContent: 'flex-end' },
  body: { flex: 1, gap: 2 },
  card: { gap: spacing.md },
  dim: { opacity: 0.5 },
  main: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  pin: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  title: { flexShrink: 1 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
});
