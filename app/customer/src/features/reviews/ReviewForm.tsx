import type { StoreReview } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Input, Notice, Text } from '@/components/ui';
import { useToast } from '@/features/notifications/ToastProvider';
import { api, describeError } from '@/lib/api';
import { spacing } from '@/theme/tokens';

import { StarPicker } from './StarPicker';

const MAX_TEXT = 1000;

/** Stars (required) and an optional comment; saves with `api.reviews.save` and goes back. */
export function ReviewForm({
  storeId,
  storeOrderId,
  storeName,
  existing,
}: {
  storeId: string;
  storeOrderId: string;
  storeName: string;
  existing: StoreReview | null;
}) {
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [text, setText] = useState(existing?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (rating < 1) {
      setError('Tap a star to rate the store.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.reviews.save(storeId, storeOrderId, { rating, text: text.trim() });
      toast({ title: existing ? 'Review updated' : 'Thanks for your review', body: storeName, icon: 'star' });
      if (router.canGoBack()) router.back();
      else router.replace(`/store/${storeId}/reviews`);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Text variant="title" align="center">
          How was {storeName}?
        </Text>
        <Text color="muted" align="center">
          Your rating helps other trades pick a supplier.
        </Text>
      </View>
      <StarPicker
        value={rating}
        onChange={(value) => {
          setRating(value);
          setError(null);
        }}
      />
      <Input
        multiline
        label="Tell others about it (optional)"
        placeholder="Order accuracy, stock, counter staff, delivery…"
        value={text}
        onChangeText={(value) => setText(value.slice(0, MAX_TEXT))}
        maxLength={MAX_TEXT}
        editable={!busy}
        hint={`${text.length} / ${MAX_TEXT}`}
        style={styles.text}
      />
      {error ? <Notice tone="danger" message={error} /> : null}
      <Button
        label={existing ? 'Update review' : 'Post review'}
        loading={busy}
        disabled={rating < 1}
        onPress={() => void submit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs },
  text: { minHeight: 120 },
  wrap: { gap: spacing.xl },
});
