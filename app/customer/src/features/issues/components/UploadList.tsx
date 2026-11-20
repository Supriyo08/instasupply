import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import type { QueuedFile } from '../useUploadQueue';

function iconFor(contentType: string): IconName {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'file-text';
  return 'grid';
}

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Picked files with their upload state: a photo thumbnail (or a file icon), Uploading…, a failure with
 * Retry, and Remove.
 */
export function UploadList({
  files,
  onRetry,
  onRemove,
}: {
  files: readonly QueuedFile[];
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <View style={styles.list}>
      {files.map((file) => (
        <View key={file.key} style={styles.row}>
          <View style={styles.thumb}>
            {file.previewUri && file.contentType.startsWith('image/') ? (
              <Image source={{ uri: file.previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Icon name={iconFor(file.contentType)} size={20} color={colors.primaryDark} />
            )}
          </View>
          <View style={styles.text}>
            <Text variant="captionMedium" numberOfLines={1}>
              {file.name}
            </Text>
            <Text variant="micro" color={file.status === 'failed' ? 'danger' : 'muted'} numberOfLines={2}>
              {file.status === 'uploading'
                ? 'Uploading…'
                : file.status === 'failed'
                  ? (file.error ?? "Couldn't upload")
                  : `Uploaded · ${sizeText(file.sizeBytes)}`}
            </Text>
          </View>
          {file.status === 'uploading' ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {file.status === 'failed' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retry uploading ${file.name}`}
              hitSlop={8}
              onPress={() => onRetry(file.key)}
            >
              <Icon name="refresh-cw" size={18} color={colors.primaryDark} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${file.name}`}
            hitSlop={8}
            onPress={() => onRemove(file.key)}
          >
            <Icon name="x" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
  },
  text: { flex: 1 },
  thumb: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
});
