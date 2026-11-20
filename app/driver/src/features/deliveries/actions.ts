/** Delivery commands of the driver app (docs/CLIENTS.md §4.6). Nothing here is optimistic (§1.12). */
import type { DeclineReasonId, DeliveryStatus, FailureReasonId, LatLng } from '@instasupply/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { api, call, errorCodeOf } from '@/lib/api';

import { createProofUploadCache } from './proof-upload-cache';

/** Accept, start the trip to the site, arrive. Release and fail have their own functions. */
export async function updateStatus(deliveryId: string, status: DeliveryStatus, location: LatLng | null) {
  return call('updateDeliveryStatus', { deliveryId, status, location });
}

/** Decline an assignment from dispatch, or release a claimed job before collection: back to `unassigned`. */
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

/**
 * Take an open job from the board. Errors to show (with `describeError`): OFFER_TAKEN (also leave the
 * screen), VEHICLE_TOO_SMALL, TOO_MANY_JOBS, RELEASED_RECENTLY, DRIVER_OFFLINE (`errorCodeOf`).
 */
export async function claimJob(deliveryId: string) {
  return call('claimJob', { deliveryId });
}

/** "I'm at the store": starts the PIN hand-over; the store confirms the collection. */
export async function checkInAtStore(deliveryId: string, location: LatLng | null) {
  return call('checkInAtStore', { deliveryId, location });
}

/** Re-plan the route from where the driver is. */
export async function optimizeRoute(origin: LatLng | null) {
  return call('optimizeRoute', { origin });
}

/**
 * Compress (width 1280, JPEG 0.6) and upload the drop-off photo; returns the confirmed storage path
 * (`proofs/{deliveryId}/…`) to pass to `completeDelivery`.
 */
export async function uploadProofPhoto(deliveryId: string, uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1280 });
  const rendered = await context.renderAsync();
  const compressed = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
  const name = `${api.newRequestId()}.jpg`;
  const source =
    Platform.OS === 'web'
      ? {
          kind: 'blob' as const,
          blob: await (await fetch(compressed.uri)).blob(),
          name,
          contentType: 'image/jpeg',
        }
      : {
          kind: 'uri' as const,
          uri: compressed.uri,
          name,
          contentType: 'image/jpeg',
          sizeBytes: await fileSize(compressed.uri),
        };
  const uploaded = await api.upload({ purpose: 'proof', ownerId: deliveryId, source });
  return uploaded.path;
}

async function fileSize(uri: string): Promise<number> {
  const blob = await (await fetch(uri)).blob();
  return blob.size;
}

/** One upload per photo and delivery, however often Complete is retried. */
const proofUploads = createProofUploadCache(uploadProofPhoto);

export interface ProofInput {
  /** Required on a marketplace delivery (`PHOTO_REQUIRED` otherwise). */
  photoUri: string | null;
  /** Asked for when the site receives the load in person (`requireCode`). */
  handoffCode: string | null;
  recipientName: string | null;
  note: string | null;
  location: LatLng | null;
}

/**
 * Upload the photo, then complete. COD is gone (MARKETPLACE §12.6). Errors: PHOTO_REQUIRED (reopen the
 * camera), CODE_INCORRECT (`detailsFor` gives the remaining attempts).
 */
export async function completeDelivery(deliveryId: string, proof: ProofInput) {
  // A retry with the same photo (wrong code, network) reuses the path uploaded the first time.
  const photoPath = proof.photoUri ? await proofUploads.pathFor(deliveryId, proof.photoUri) : null;
  try {
    const result = await call('completeDelivery', {
      deliveryId,
      photoPath,
      handoffCode: proof.handoffCode?.trim() || null,
      recipientName: proof.recipientName?.trim() || null,
      note: proof.note?.trim() || null,
      location: proof.location,
    });
    proofUploads.forget(deliveryId);
    return result;
  } catch (error) {
    if (errorCodeOf(error) === 'PHOTO_REQUIRED') proofUploads.forget(deliveryId);
    throw error;
  }
}
