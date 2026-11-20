import { StyleSheet, View } from 'react-native';

import { Card, EmptyState, Screen, Text } from '@/components/ui';

/**
 * Stand-in for a route a screen builder has not written yet (see CONVENTIONS.md). It names the spec
 * rows and the hooks the screen is built from, so the app runs end to end in the meantime.
 */
export function RoutePlaceholder({
  title,
  spec,
  uses,
  header = true,
}: {
  title: string;
  /** For example "MARKETPLACE §10 (tabs)/jobs; CLIENTS §4.6". */
  spec: string;
  /** Hooks and commands the screen uses. */
  uses: string[];
  /** False inside a stack screen that already shows a native header. */
  header?: boolean;
}) {
  return (
    <Screen edges={header ? ['top'] : []}>
      <EmptyState icon="construct-outline" title={title} message="This screen is being built." />
      <Card>
        <View style={styles.list}>
          <Text variant="caption" color="subtle">
            {spec}
          </Text>
          {uses.map((line) => (
            <Text key={line} variant="caption" color="muted">
              • {line}
            </Text>
          ))}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { gap: 4 } });
