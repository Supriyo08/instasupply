import { describeError } from '@instasupply/expo-firebase';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Header, Screen, Skeleton, Text } from '@/components/ui';
import { useMyReview, useProduct } from '@/features/catalog/hooks';
import { saveReview } from '@/features/catalog/reviews';
import { useToast } from '@/features/notifications/ToastProvider';
import { ProductArt } from '@/features/product/ProductArt';
import { ReviewTextArea } from '@/features/product/ReviewTextArea';
import { StarPicker } from '@/features/product/StarPicker';
import { useCustomer } from '@/features/session/SessionProvider';
import { spacing } from '@/theme/tokens';

interface Draft {
  rating: number;
  text: string;
}

/** "Write Reviews" from the Big Cart design; edits the shopper's existing review when there is one. */
export default function WriteReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useCustomer();
  const product = useProduct(id);
  const existing = useMyReview(id, user.uid);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once we know whether this shopper already reviewed the product.
  if (draft === null && !existing.loading) {
    setDraft({ rating: existing.data?.rating ?? 0, text: existing.data?.text ?? '' });
  }
  const editing = existing.data != null;

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setError(null);
  };

  const submit = async () => {
    if (!draft || !id) return;
    if (draft.rating < 1) {
      setError('Tap a star to rate this product.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveReview({
        productId: id,
        uid: user.uid,
        userName: (profile.displayName ?? '').trim() || 'InstaSupply shopper',
        rating: draft.rating,
        text: draft.text,
        isUpdate: editing,
        createdAt: existing.data?.createdAt,
      });
      toast({ title: editing ? 'Review updated' : 'Thanks for your review!', icon: 'star' });
      if (router.canGoBack()) router.back();
      else router.replace(`/product/${id}`);
    } catch (caught) {
      setSaving(false);
      setError(describeError(caught, "We couldn't save your review. Please try again."));
    }
  };

  return (
    <Screen
      header={<Header title={editing ? 'Edit Review' : 'Write Review'} />}
      footer={
        <Button
          label={editing ? 'Update review' : 'Submit review'}
          trailingIcon="send"
          loading={saving}
          disabled={draft === null}
          onPress={() => void submit()}
        />
      }
    >
      {draft === null ? (
        <View style={styles.intro} accessible accessibilityLabel="Loading">
          <Skeleton style={styles.artSkeleton} />
          <Skeleton style={styles.titleSkeleton} />
          <Skeleton style={styles.starsSkeleton} />
          <Skeleton style={styles.areaSkeleton} />
        </View>
      ) : (
        <>
          <View style={styles.intro}>
            {product.data ? <ProductArt product={product.data} size={88} /> : null}
            <Text variant="title" align="center" accessibilityRole="header">
              What do you think?
            </Text>
            <Text color="muted" align="center" style={styles.subtitle}>
              {product.data
                ? `Please rate ${product.data.name} by tapping the stars below.`
                : 'Please give your rating by tapping the stars below.'}
            </Text>
          </View>
          <StarPicker value={draft.rating} onChange={(rating) => update({ rating })} />
          <ReviewTextArea value={draft.text} onChangeText={(text) => update({ text })} />
          {error ? (
            <Text variant="captionMedium" color="danger" align="center" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  areaSkeleton: { height: 180, marginTop: spacing.lg, width: '100%' },
  artSkeleton: { borderRadius: 44, height: 88, width: 88 },
  intro: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  starsSkeleton: { height: 42, marginTop: spacing.lg, width: 240 },
  subtitle: { maxWidth: 300 },
  titleSkeleton: { height: 24, width: 200 },
});
