/**
 * Upload purposes (docs/PLATFORM.md §10.1): path prefix, size, content types, caps, and whether files are
 * public. The path prefixes are those of MARKETPLACE §6.4 (`STORAGE_FOLDERS`).
 *
 * `UPLOAD_LIMITS` belongs in packages/shared/src/constants.ts (PLATFORM §16 edit 9); until the shared team
 * adds it, the numbers live here once, and this copy is deleted when shared exports it.
 */
import { STORAGE_FOLDERS, type UploadPurpose } from '@instasupply/shared';

const MB = 1024 * 1024;

/** SVG is never accepted: it can carry script. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
const QUOTE_TYPES = [
  ...IMAGE_TYPES,
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const UPLOAD_LIMITS: Record<
  UploadPurpose,
  { maxBytes: number; contentTypes: readonly string[]; perScope: { max: number; perDay: boolean } }
> = {
  proof: { maxBytes: 10 * MB, contentTypes: IMAGE_TYPES, perScope: { max: 5, perDay: false } },
  quote_upload: { maxBytes: 15 * MB, contentTypes: QUOTE_TYPES, perScope: { max: 10, perDay: false } },
  issue_photo: { maxBytes: 10 * MB, contentTypes: IMAGE_TYPES, perScope: { max: 12, perDay: false } },
  store_photo: { maxBytes: 5 * MB, contentTypes: IMAGE_TYPES, perScope: { max: 20, perDay: true } },
  product_photo: { maxBytes: 5 * MB, contentTypes: IMAGE_TYPES, perScope: { max: 300, perDay: true } },
  avatar: { maxBytes: 5 * MB, contentTypes: IMAGE_TYPES, perScope: { max: 5, perDay: true } },
};

export const PUBLIC_PURPOSES: ReadonlySet<UploadPurpose> = new Set([
  'store_photo',
  'product_photo',
  'avatar',
]);

export const UPLOAD_PURPOSES = Object.keys(UPLOAD_LIMITS) as UploadPurpose[];

/** The folder of the final path; `quote_upload` nests the uploader's uid before the request id. */
export function folderFor(purpose: UploadPurpose, ownerId: string, uid: string): string {
  switch (purpose) {
    case 'proof':
      return `${STORAGE_FOLDERS.proofs}/${ownerId}`;
    case 'quote_upload':
      return `${STORAGE_FOLDERS.quoteUploads}/${uid}/${ownerId}`;
    case 'issue_photo':
      return `${STORAGE_FOLDERS.issuePhotos}/${ownerId}`;
    case 'store_photo':
      return `${STORAGE_FOLDERS.storePhotos}/${ownerId}`;
    case 'product_photo':
      return `${STORAGE_FOLDERS.productPhotos}/${ownerId}`;
    case 'avatar':
      return `${STORAGE_FOLDERS.avatars}/${ownerId}`;
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export const extensionFor = (contentType: string): string => EXTENSIONS[contentType] ?? 'bin';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** True when the first bytes are a JPEG, PNG, WebP or HEIC/HEIF signature. */
export function looksLikeImage(start: Buffer): boolean {
  if (start.length >= 3 && start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) return true;
  if (
    start.length >= 8 &&
    start.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return true;
  }
  if (
    start.length >= 12 &&
    start.toString('latin1', 0, 4) === 'RIFF' &&
    start.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return true;
  }
  return (
    start.length >= 12 &&
    start.toString('latin1', 4, 8) === 'ftyp' &&
    HEIF_BRANDS.has(start.toString('latin1', 8, 12))
  );
}

export const isImageType = (contentType: string): boolean =>
  (IMAGE_TYPES as readonly string[]).includes(contentType);
