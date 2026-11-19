import { formatCurrency } from '@instasupply/shared';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Icon, Input, Screen, Text } from '@/components/ui';
import { completeDelivery } from '@/features/deliveries/actions';
import { useDelivery } from '@/features/deliveries/hooks';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { usePresence } from '@/features/location/PresenceProvider';
import { describeError } from '@/lib/errors';
import { useTheme } from '@/theme/ThemeProvider';

export default function CompleteDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: delivery } = useDelivery(id);
  const { colors, radius } = useTheme();
  const { currentPosition } = usePresence();
  const [recipient, setRecipient] = useState('');
  const [code, setCode] = useState('');
  const [cod, setCod] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!delivery) return <Screen edges={[]}>{null}</Screen>;
  const codValue = cod ?? (delivery.codAmount ? String(delivery.codAmount) : '');

  const takePhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          notify('Camera access needed', 'Allow camera access in Settings to add a photo.');
          return;
        }
      }
      const launch =
        Platform.OS === 'web' ? ImagePicker.launchImageLibraryAsync : ImagePicker.launchCameraAsync;
      const result = await launch({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
    } catch (cause) {
      notify("Couldn't open the camera", describeError(cause));
    }
  };

  const submit = async () => {
    if (!recipient.trim() && !photo) return setError("Add the recipient's name or a photo.");
    if (delivery.requireCode && code.replace(/\D/g, '').length !== 4)
      return setError('Enter the 4-digit hand-off code.');
    const codCollected = delivery.codAmount ? Number(codValue) : null;
    if (delivery.codAmount && (codCollected == null || Number.isNaN(codCollected)))
      return setError('Enter the cash collected.');

    setBusy(true);
    setError(null);
    try {
      const position = await currentPosition();
      await completeDelivery(delivery.id, {
        recipientName: recipient.trim() || null,
        handoffCode: delivery.requireCode ? code : null,
        photoUri: photo,
        codCollected,
        note: note.trim() || null,
        location: position ? { lat: position.lat, lng: position.lng } : null,
      });
      router.dismissTo('/');
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
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
          onPress={submit}
        />
      }
    >
      <View style={styles.intro}>
        <Text variant="title">{delivery.customer.name}</Text>
        <Text color="muted">{delivery.address}</Text>
      </View>
      {error ? <Banner tone="danger" message={error} /> : null}

      <Input
        label="Received by"
        icon="person-outline"
        placeholder="Name of the person who took the package"
        value={recipient}
        onChangeText={setRecipient}
      />
      <Pressable onPress={() => setRecipient(delivery.customer.name)}>
        <Text variant="caption" color="primary">
          Use “{delivery.customer.name}”
        </Text>
      </Pressable>

      {delivery.requireCode ? (
        <Input
          label="Hand-off code"
          icon="key-outline"
          placeholder="4 digits"
          keyboardType="number-pad"
          maxLength={4}
          value={code}
          onChangeText={setCode}
          hint="The customer sees this code on their tracking page."
        />
      ) : null}

      {delivery.codAmount ? (
        <Input
          label={`Cash collected (due ${formatCurrency(delivery.codAmount)})`}
          icon="cash-outline"
          keyboardType="decimal-pad"
          value={codValue}
          onChangeText={setCod}
        />
      ) : null}

      <Card>
        {photo ? (
          <View style={styles.photoWrap}>
            <Image
              source={{ uri: photo }}
              style={[styles.photo, { borderRadius: radius.md }]}
              accessibilityLabel="Proof photo"
            />
            <Button
              label="Retake photo"
              variant="secondary"
              icon="camera-reverse-outline"
              onPress={takePhoto}
            />
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={takePhoto} style={styles.photoPrompt}>
            <View style={[styles.cameraIcon, { backgroundColor: colors.primarySoft }]}>
              <Icon name="camera" size={26} color={colors.primary} />
            </View>
            <Text variant="bodyStrong">Add a photo</Text>
            <Text variant="caption" color="subtle" align="center">
              A clear photo of the package at the door protects you and the customer.
            </Text>
          </Pressable>
        )}
      </Card>

      <Input
        label="Note (optional)"
        placeholder="Left with the security guard…"
        value={note}
        onChangeText={setNote}
        multiline
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraIcon: { alignItems: 'center', borderRadius: 30, height: 60, justifyContent: 'center', width: 60 },
  intro: { gap: 4 },
  photo: { aspectRatio: 4 / 3, width: '100%' },
  photoPrompt: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  photoWrap: { gap: 12 },
});
