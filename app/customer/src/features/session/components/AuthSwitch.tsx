import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';

/** "Don't have an account? Sign up" line under auth forms. */
export function AuthSwitch({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text color="muted">{prompt}</Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={action}
        hitSlop={10}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="bodyMedium">{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
});
