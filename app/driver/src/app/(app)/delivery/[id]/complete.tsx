import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import { completeDelivery } from '@/features/deliveries/actions';
import { useDelivery } from '@/features/deliveries/hooks';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { usePresence } from '@/features/location/PresenceProvider';
import { describeError, detailsFor, errorCodeOf } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';

const CODE_LENGTH = 4;

/**
 * Proof of drop-off (MARKETPLACE §10 `delivery/[id]/complete`, §2.3 "Proof"; CLIENTS §4.6): the photo
 * is required, the hand-off code too when someone receives the load, the recipient's name is optional.
 * COD is gone (MARKETPLACE §12.6, R66): there is no cash field.
 */
export default function CompleteDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const delivery = useDelivery(id);
  const { colors, radius } = useTheme();
  const { currentPosition } = usePresence();
  const [photo, setPhoto] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (delivery.loading) {
    return (
      <Screen edges={[]}>
        <Skeleton height={60} />
        <Skeleton height={220} radius={16} />
      </Screen>
    );
  }
  if (delivery.error) {
    return (
      <Screen edges={[]}>
        <ErrorState error={delivery.error} onRetry={delivery.retry} title="Couldn't load this delivery" />
      </Screen>
    );
  }
  const data = delivery.data;
  if (!data || data.status !== 'arrived') {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="checkmark-done-outline"
          title={data?.status === 'delivered' ? 'Already delivered' : 'Nothing to complete here'}
          message={
            data?.status === 'delivered'
              ? 'This drop-off is recorded. Thanks!'
              : 'Tap "I\'ve arrived" on the delivery first, then add the drop-off photo.'
          }
          action={<Button label="Back" fullWidth={false} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const needsCode = data.requireCode;

  const takePhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          notify('Camera access needed', 'Allow camera access in Settings to take the drop-off photo.');
          return;
        }
      }
      // The web has no camera intent: the browser offers the camera or a file.
      const launch =
        Platform.OS === 'web' ? ImagePicker.launchImageLibraryAsync : ImagePicker.launchCameraAsync;
      const result = await launch({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        setPhoto(result.assets[0].uri);
        setError(null);
      }
    } catch (cause) {
      notify("Couldn't open the camera", describeError(cause));
    }
  };

  const submit = async () => {
    setError(null);
    setCodeError(null);
    if (!photo) {
      setError('Take a photo of the load where you left it.');
      void takePhoto();
      return;
    }
    const digits = code.replace(/\D/g, '');
    if (needsCode && digits.length !== CODE_LENGTH) {
      setCodeError(`Enter the ${CODE_LENGTH}-digit hand-off code from the person receiving the load.`);
      return;
    }
    setBusy(true);
    try {
      const position = await currentPosition();
      await completeDelivery(data.id, {
        photoUri: photo,
        handoffCode: needsCode ? digits : null,
        recipientName: recipient.trim() || null,
        note: note.trim() || null,
        location: position ? { lat: position.lat, lng: position.lng } : null,
      });
      router.dismissTo('/');
    } catch (cause) {
      setBusy(false);
      const codeOf = errorCodeOf(cause);
      if (codeOf === 'PHOTO_REQUIRED') {
        setPhoto(null);
        setError('The photo did not reach us. Take it again.');
        void takePhoto();
        return;
      }
      if (codeOf === 'CODE_INCORRECT') {
        const remaining = detailsFor(cause, 'CODE_INCORRECT')?.remaining ?? null;
        setCodeError(
          remaining == null
            ? "That code doesn't match. Check it with the person receiving the load."
            : `That code doesn't match. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`,
        );
        return;
      }
      if (codeOf === 'CODE_LOCKED') {
        setCodeError('Too many wrong codes. Message dispatch to finish this drop-off.');
        return;
      }
      setError(describeError(cause));
    }
  };

  return (
    <Screen
      edges={[]}
      keyboard
      footer={
        <Button
          label="Complete delivery"
          size="lg"
          icon="checkmark-done"
          variant="success"
          loading={busy}
          onPress={() => void submit()}
        />
      }
    >
      <View style={styles.intro}>
        <Text variant="title">{data.address}</Text>
        <Text color="muted">
          {data.orderId} · {data.customer.name}
        </Text>
      </View>
      {error ? <Banner tone="danger" message={error} /> : null}

      <Card>
        {photo ? (
          <View style={styles.photoWrap}>
            <Image
              source={{ uri: photo }}
              style={[styles.photo, { borderRadius: radius.md }]}
              accessibilityLabel="Drop-off photo"
            />
            <Button
              label="Retake photo"
              variant="secondary"
              icon="camera-reverse-outline"
              onPress={() => void takePhoto()}
            />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take the drop-off photo (required)"
            onPress={() => void takePhoto()}
            style={styles.photoPrompt}
          >
            <View style={[styles.cameraIcon, { backgroundColor: colors.primarySoft }]}>
              <Icon name="camera" size={28} color={colors.primary} />
            </View>
            <Text variant="heading">Drop-off photo (required)</Text>
            <Text variant="caption" color="muted" align="center">
              Show the whole load where you left it, with something that shows the site (fence, door, sign).
            </Text>
          </Pressable>
        )}
      </Card>

      {needsCode ? (
        <Input
          label="Hand-off code"
          icon="key-outline"
          placeholder={`${CODE_LENGTH} digits`}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          value={code}
          onChangeText={(value) => {
            setCode(value);
            setCodeError(null);
          }}
          error={codeError}
          hint="The person receiving the load has this code on their order."
        />
      ) : (
        <Text variant="caption" color="subtle">
          Unattended site: no code needed. The photo is the proof.
        </Text>
      )}
      {!needsCode && codeError ? <Banner tone="danger" message={codeError} /> : null}

      <Input
        label="Received by (optional)"
        icon="person-outline"
        placeholder="Name of the person who took the load"
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="words"
      />
      {data.customer.name ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Use ${data.customer.name} as the recipient`}
          onPress={() => setRecipient(data.customer.name)}
        >
          <Text variant="caption" color="primary">
            Use “{data.customer.name}”
          </Text>
        </Pressable>
      ) : null}

      <Input
        label="Note (optional)"
        icon="create-outline"
        placeholder="e.g. Left on pallets behind the site trailer"
        value={note}
        onChangeText={setNote}
        multiline
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraIcon: { alignItems: 'center', borderRadius: 32, height: 64, justifyContent: 'center', width: 64 },
  intro: { gap: 4 },
  photo: { aspectRatio: 4 / 3, width: '100%' },
  photoPrompt: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  photoWrap: { gap: 12 },
});
