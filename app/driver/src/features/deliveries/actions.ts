import type { DeclineReasonId, DeliveryStatus, FailureReasonId, LatLng } from '@instasupply/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ref, uploadBytes } from 'firebase/storage';

import { call } from '@/lib/callables';
import { storage } from '@/lib/firebase';

export async function updateStatus(deliveryId: string, status: DeliveryStatus, location: LatLng | null) {
  return call('updateDeliveryStatus', { deliveryId, status, location });
}

export async function declineDelivery(deliveryId: string, reason: DeclineReasonId, note: string | null) {
  return call('updateDeliveryStatus', { deliveryId, status: 'unassigned', declineReason: reason, note });
}

export async function failDelivery(
  deliveryId: string,
  reason: FailureReasonId,
  note: string | null,
  location: LatLng | null,
) {
  return call('updateDeliveryStatus', {
    deliveryId,
    status: 'failed',
    failureReason: reason,
    note,
    location,
  });
}

/** Compress and upload a proof-of-delivery photo; returns its Storage path. */
export async function uploadProofPhoto(deliveryId: string, uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1280 });
  const rendered = await context.renderAsync();
  const compressed = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
  const blob = await (await fetch(compressed.uri)).blob();
  const path = `proofs/${deliveryId}/${Date.now()}.jpg`;
  await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' });
  return path;
}

export interface ProofInput {
  recipientName: string | null;
  handoffCode: string | null;
  photoUri: string | null;
  codCollected: number | null;
  note: string | null;
  location: LatLng | null;
}

export async function completeDelivery(deliveryId: string, proof: ProofInput) {
  const photoPath = proof.photoUri ? await uploadProofPhoto(deliveryId, proof.photoUri) : null;
  return call('completeDelivery', {
    deliveryId,
    recipientName: proof.recipientName,
    handoffCode: proof.handoffCode,
    photoPath,
    codCollected: proof.codCollected,
    note: proof.note,
    location: proof.location,
  });
}
