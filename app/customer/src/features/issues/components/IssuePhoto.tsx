import { useFileUrl } from '@instasupply/api-client/react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Skeleton } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** One photo of a case, through a short-lived URL (`useFileUrl`, refreshed before it expires). */
export function IssuePhoto({ path, index }: { path: string; index: number }) {
  const file = useFileUrl(path);
  if (file.loading && !file.url) return <Skeleton style={styles.photo} />;
  if (!file.url) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Photo ${index + 1} didn't load. Try again`}
        onPress={file.retry}
        style={[styles.photo, styles.missing]}
      >
        <Icon name="refresh-cw" size={18} color={colors.textMuted} />
      </Pressable>
    );
  }
  return (
    <View style={styles.photo}>
      <Image
        source={{ uri: file.url }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        accessibilityLabel={`Photo ${index + 1} of the problem`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { alignItems: 'center', backgroundColor: colors.background, justifyContent: 'center' },
  photo: { borderRadius: radius.md, height: 96, overflow: 'hidden', width: 96 },
});
