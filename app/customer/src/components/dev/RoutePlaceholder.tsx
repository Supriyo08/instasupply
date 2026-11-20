import { StyleSheet, View } from 'react-native';

import { EmptyState, Header, Screen, Text } from '@/components/ui';
import { RequireAccount } from '@/features/session/RequireAccount';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * Stand-in for a route a screen builder has not written yet. It keeps the route tree of
 * MARKETPLACE §7.3 complete, so links and deep links resolve while screens are built in parallel.
 * Delete the import when the real screen lands; nothing else depends on this file.
 */
export function RoutePlaceholder({
  title,
  spec,
  locked = false,
  tab = false,
}: {
  title: string;
  /** The MARKETPLACE §7.3 / docs/CLIENTS.md §4.3 row the screen implements. */
  spec: string;
  /** 🔒: guests see "Sign in to order" instead. */
  locked?: boolean;
  /** A tab root: no back arrow. */
  tab?: boolean;
}) {
  const body = (
    <Screen header={<Header title={title} back={!tab} />}>
      <EmptyState
        art="scene-local-suppliers"
        title={`${title} is on its way`}
        message="This screen is being built."
      />
      <View style={styles.spec}>
        <Text variant="micro" color="muted">
          {spec}
        </Text>
      </View>
    </Screen>
  );
  return locked ? <RequireAccount title={title}>{body}</RequireAccount> : body;
}

const styles = StyleSheet.create({
  spec: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
});
