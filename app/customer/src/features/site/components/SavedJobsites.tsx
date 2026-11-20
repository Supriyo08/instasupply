import type { Jobsite } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ErrorState, Icon, Skeleton, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** The customer's jobsites as radio rows (default first); "Manage" opens the jobsite list. */
export function SavedJobsites({
  jobsites,
  selectedId,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  jobsites: readonly Jobsite[];
  selectedId: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (jobsite: Jobsite) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text variant="heading">Saved jobsites</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Manage jobsites"
          hitSlop={8}
          onPress={() => router.push('/jobsites')}
        >
          <Text variant="captionMedium" color="primary">
            Manage
          </Text>
        </Pressable>
      </View>
      {loading && jobsites.length === 0 ? (
        <Skeleton style={styles.skeleton} />
      ) : error && jobsites.length === 0 ? (
        <ErrorState title="Couldn't load your jobsites" error={error} onRetry={onRetry} />
      ) : jobsites.length === 0 ? (
        <Text variant="caption" color="muted">
          No jobsites yet. Find your site below and save it for next time.
        </Text>
      ) : (
        <View style={styles.card}>
          {jobsites.map((jobsite, index) => {
            const selected = jobsite.id === selectedId;
            return (
              <Pressable
                key={jobsite.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${jobsite.label}, ${jobsite.line1}, ${jobsite.city}${jobsite.isDefault ? ', default' : ''}`}
                onPress={() => onSelect(jobsite)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.divider : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Icon
                  name={selected ? 'check-circle' : 'circle'}
                  size={20}
                  color={selected ? colors.primary : colors.textSubtle}
                />
                <View style={styles.info}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {jobsite.label}
                    {jobsite.isDefault ? (
                      <Text variant="caption" color="muted">
                        {'  · Default'}
                      </Text>
                    ) : null}
                  </Text>
                  <Text variant="caption" color="muted" numberOfLines={1}>
                    {jobsite.line1}, {jobsite.city}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md },
  divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  info: { flex: 1 },
  pressed: { opacity: 0.7 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  section: { gap: spacing.md },
  skeleton: { height: 112 },
});
