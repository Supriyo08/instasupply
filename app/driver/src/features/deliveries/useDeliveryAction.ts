import type { DeliveryStatus } from '@instasupply/shared';
import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { usePresence } from '@/features/location/PresenceProvider';
import { describeError } from '@/lib/api';

import { updateStatus } from './actions';

/** A one-button alert that also works on the web (Alert.alert with buttons does nothing there). */
export function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** Status updates with the driver's position attached, a busy flag and friendly errors. */
export function useDeliveryAction() {
  const { currentPosition } = usePresence();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = useCallback(
    async (deliveryId: string, status: DeliveryStatus) => {
      setBusyId(deliveryId);
      try {
        const position = await currentPosition();
        await updateStatus(deliveryId, status, position ? { lat: position.lat, lng: position.lng } : null);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return true;
      } catch (error) {
        notify("Couldn't update the delivery", describeError(error));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [currentPosition],
  );

  return { run, busyId };
}
