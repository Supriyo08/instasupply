import type { UploadSource } from '@instasupply/api-client';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** Longest side of an uploaded photo; enough to read a label or see a crack. */
const MAX_PHOTO_SIDE = 2048;

export type PickResult =
  | { status: 'picked'; sources: UploadSource[] }
  | { status: 'cancelled' }
  | { status: 'denied'; message: string };

async function sizeOfUri(uri: string): Promise<number> {
  try {
    const blob = await (await fetch(uri)).blob();
    return blob.size;
  } catch {
    return 0;
  }
}

/** Downscales and re-encodes a photo as JPEG on the device before upload (native only). */
async function compressPhoto(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; sizeBytes: number }> {
  const context = ImageManipulator.manipulate(uri);
  const longest = Math.max(width, height);
  if (longest > MAX_PHOTO_SIDE) {
    context.resize(
      width >= height ? { width: MAX_PHOTO_SIDE, height: null } : { width: null, height: MAX_PHOTO_SIDE },
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return { uri: saved.uri, sizeBytes: await sizeOfUri(saved.uri) };
}

async function photoSource(asset: ImagePicker.ImagePickerAsset, index: number): Promise<UploadSource> {
  const name = asset.fileName ?? `photo-${index + 1}.jpg`;
  if (Platform.OS === 'web') {
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    return { kind: 'blob', blob, name, contentType: asset.mimeType ?? blob.type ?? 'image/jpeg' };
  }
  try {
    const compressed = await compressPhoto(asset.uri, asset.width, asset.height);
    return {
      kind: 'uri',
      uri: compressed.uri,
      name: name.replace(/\.[a-z0-9]+$/i, '.jpg'),
      contentType: 'image/jpeg',
      sizeBytes: compressed.sizeBytes,
    };
  } catch {
    return {
      kind: 'uri',
      uri: asset.uri,
      name,
      contentType: asset.mimeType ?? 'image/jpeg',
      sizeBytes: asset.fileSize ?? (await sizeOfUri(asset.uri)),
    };
  }
}

/**
 * Photos for an issue report or a material list: from the library, or the camera with
 * `camera: true`. Native photos are compressed first. Check each result with `validateUpload`.
 */
export async function pickPhotos(options: { camera?: boolean; max: number }): Promise<PickResult> {
  if (options.max <= 0) return { status: 'cancelled' };
  if (options.camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'denied', message: 'Allow camera access to take a photo.' };
  }
  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: !options.camera && options.max > 1,
    selectionLimit: options.max,
  };
  const result = options.camera
    ? await ImagePicker.launchCameraAsync(pickerOptions)
    : await ImagePicker.launchImageLibraryAsync(pickerOptions);
  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
  const sources = await Promise.all(result.assets.slice(0, options.max).map(photoSource));
  return { status: 'picked', sources };
}

/** Material-list files: photos, PDF, CSV or Excel. Native files are copied to the cache (`file://`). */
export async function pickDocuments(options: { max: number }): Promise<PickResult> {
  if (options.max <= 0) return { status: 'cancelled' };
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'image/*',
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    multiple: options.max > 1,
    copyToCacheDirectory: true,
  });
  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
  const sources = await Promise.all(
    result.assets.slice(0, options.max).map(async (asset): Promise<UploadSource> => {
      const contentType = asset.mimeType ?? 'application/octet-stream';
      if (Platform.OS === 'web') {
        const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
        return { kind: 'blob', blob, name: asset.name, contentType };
      }
      return {
        kind: 'uri',
        uri: asset.uri,
        name: asset.name,
        contentType,
        sizeBytes: asset.size ?? (await sizeOfUri(asset.uri)),
      };
    }),
  );
  return { status: 'picked', sources };
}
