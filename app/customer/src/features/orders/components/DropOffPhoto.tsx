import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Notice, Skeleton, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { useStoreOrderProof } from '../hooks';
import { dayAndClock } from '../order-format';

/** The drop-off photo and who received the load, once a store order is delivered. */
export function DropOffPhoto({ storeOrderId, now }: { storeOrderId: string; now: number }) {
  const proof = useStoreOrderProof(storeOrderId);
  if (proof.loading && !proof.data) return <Skeleton style={styles.photo} />;
  if (proof.error && !proof.data) {
    return (
      <Notice
        tone="warning"
        message="We couldn't load the drop-off photo."
        actionLabel="Try again"
        onAction={proof.retry}
      />
    );
  }
  const data = proof.data;
  if (!data || (!data.photoUrl && !data.recipientName)) return null;
  const caption = [
    data.recipientName ? `Received by ${data.recipientName}` : 'Left at the site',
    data.deliveredAt != null ? dayAndClock(data.deliveredAt, now) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.wrap}>
      <Text variant="captionMedium">Drop-off photo</Text>
      {data.photoUrl ? (
        <Image
          source={{ uri: data.photoUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
          accessibilityLabel={`Drop-off photo. ${caption}`}
        />
      ) : null}
      <Text variant="caption" color="muted">
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 4 / 3, backgroundColor: colors.background, borderRadius: radius.md, width: '100%' },
  wrap: { gap: spacing.xs + 2 },
});
