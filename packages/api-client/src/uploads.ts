import type { PresignedUpload, UploadedFile, UploadPurpose } from './contract';
import { ApiError, toApiError } from './errors';
import type { Rest } from './rest';

export type { PresignedUpload, UploadedFile, UploadPurpose } from './contract';

export interface UploadLimit {
  maxBytes: number;
  contentTypes: readonly string[];
  /** Server-side cap per owner (or per day), shown in forms; the client does not count uploads. */
  perScope: { max: number; perDay: boolean };
}

const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

/**
 * The upload limits of PLATFORM §10.1. PLATFORM §16 row 9 moves this constant to
 * `@instasupply/shared` (where the server reads it too); until it lands, this copy has the same numbers.
 */
export const UPLOAD_LIMITS: Readonly<Record<UploadPurpose, UploadLimit>> = {
  proof: { maxBytes: 10 * MB, contentTypes: IMAGES, perScope: { max: 5, perDay: false } },
  quote_upload: {
    maxBytes: 15 * MB,
    contentTypes: [
      ...IMAGES,
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    perScope: { max: 10, perDay: false },
  },
  issue_photo: { maxBytes: 10 * MB, contentTypes: IMAGES, perScope: { max: 12, perDay: false } },
  store_photo: { maxBytes: 5 * MB, contentTypes: IMAGES, perScope: { max: 20, perDay: true } },
  product_photo: { maxBytes: 5 * MB, contentTypes: IMAGES, perScope: { max: 300, perDay: true } },
  avatar: { maxBytes: 5 * MB, contentTypes: IMAGES, perScope: { max: 5, perDay: true } },
};

export type UploadSource =
  /** Browsers, and Expo web. */
  | { kind: 'blob'; blob: Blob; name: string; contentType: string }
  /** React Native: a file URI from the camera, the image picker or the document picker. */
  | { kind: 'uri'; uri: string; name: string; contentType: string; sizeBytes: number };

export interface UploadInput {
  purpose: UploadPurpose;
  /** deliveryId, requestId, issueId, storeId or uid, by purpose. */
  ownerId: string;
  source: UploadSource;
  signal?: AbortSignal;
}

function sizeOf(source: UploadSource): number {
  return source.kind === 'blob' ? source.blob.size : source.sizeBytes;
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/** Local checks before any request, so the user gets the limit as a form error. Null when the file is fine. */
export function validateUpload(purpose: UploadPurpose, source: UploadSource): string | null {
  const limit = UPLOAD_LIMITS[purpose];
  const type = source.contentType.toLowerCase();
  if (!limit.contentTypes.includes(type)) {
    return limit.contentTypes.length === IMAGES.length
      ? 'Choose a photo (JPEG, PNG, WebP or HEIC).'
      : 'Choose a photo, a PDF, a CSV or an Excel file.';
  }
  const size = sizeOf(source);
  if (!Number.isFinite(size) || size <= 0) return 'That file is empty.';
  if (size > limit.maxBytes) return `That file is too large. The limit is ${formatMb(limit.maxBytes)}.`;
  return null;
}

export interface UploadDeps {
  rest: Rest;
  /** The runtime's fetch, without our headers: the storage target is not our API. */
  fetch: typeof fetch;
  uploadMs: number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** React Native's form-data file part: `{ uri, name, type }` stands in for a Blob there. */
interface NativeFilePart {
  uri: string;
  name: string;
  type: string;
}

function appendFile(form: FormData, source: UploadSource): void {
  if (source.kind === 'blob') {
    form.append('file', source.blob, source.name);
  } else {
    const part: NativeFilePart = { uri: source.uri, name: source.name, type: source.contentType };
    // React Native's FormData accepts this object; the DOM typings only know Blob.
    form.append('file', part as unknown as Blob);
  }
}

/** Presign, send the bytes straight to storage, confirm (CLIENTS §1.8, PLATFORM §10.1). */
export async function uploadFile(deps: UploadDeps, input: UploadInput): Promise<UploadedFile> {
  const problem = validateUpload(input.purpose, input.source);
  if (problem) {
    throw new ApiError({
      status: 'invalid-argument',
      message: problem,
      method: 'POST',
      path: '/files/presign',
      fromServer: true,
    });
  }
  const { source } = input;
  const presigned = await deps.rest.post<PresignedUpload>(
    '/files/presign',
    {
      purpose: input.purpose,
      ownerId: input.ownerId,
      fileName: source.name,
      contentType: source.contentType,
      sizeBytes: sizeOf(source),
    },
    { signal: input.signal },
  );

  let body: BodyInit;
  const headers: Record<string, string> = {};
  if (presigned.method === 'POST') {
    const form = new FormData();
    for (const [name, value] of Object.entries(presigned.fields)) form.append(name, value);
    appendFile(form, source);
    body = form;
    // No Content-Type: the runtime adds it with the multipart boundary.
  } else {
    Object.assign(headers, presigned.headers);
    body = source.kind === 'blob' ? source.blob : await (await deps.fetch(source.uri)).blob();
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = deps.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.uploadMs);
  const onAbort = (): void => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await deps.fetch(presigned.url, {
      method: presigned.method,
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError({
        status: response.status >= 500 ? 'unavailable' : 'failed-precondition',
        message: 'The file could not be uploaded. Please try again.',
        httpStatus: response.status,
        method: presigned.method,
        path: '/files/upload',
      });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const status = timedOut ? 'deadline-exceeded' : input.signal?.aborted ? 'cancelled' : 'unavailable';
    throw new ApiError({
      status,
      message: toApiError(error).message,
      method: presigned.method,
      path: '/files/upload',
      cause: error,
    });
  } finally {
    deps.clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }

  return deps.rest.post<UploadedFile>('/files/confirm', { uploadId: presigned.uploadId }, { signal: input.signal });
}
