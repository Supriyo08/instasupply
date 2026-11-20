import type { ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * What a route group shows when a screen throws while rendering, instead of a blank app (code review
 * R56). Export it from a layout as `export { RouteErrorBoundary as ErrorBoundary }`. Uses no context
 * beyond the theme, because it may render above the providers that failed.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useTheme();
  if (__DEV__) console.error(error);
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <EmptyState
        icon="warning-outline"
        title="Something went wrong"
        message="This screen hit a problem. Try again; if it keeps happening, restart the app."
        action={<Button label="Try again" icon="refresh" fullWidth={false} onPress={() => void retry()} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
});
