import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArtImage } from './ArtImage';
import { Text } from './Text';

export function EmptyState({
  art,
  title,
  message,
  action,
}: {
  art: string;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.container}>
      <ArtImage artKey={art} width={240} height={200} />
      <Text variant="title" align="center">
        {title}
      </Text>
      {message ? (
        <Text color="muted" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'stretch', marginTop: 12 },
  container: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 32 },
  message: { maxWidth: 300 },
});
