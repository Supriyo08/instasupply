/**
 * Uploads and authorized reads (docs/PLATFORM.md §10.1): presign → the client posts the form → confirm
 * (size, type and magic number checked on the stored object, then copied to its final path, which no form
 * can write) → commands accept the path through `requireReadyFile`.
 */
import type {
  FileUrlResponse,
  PresignedUpload,
  PresignRequest,
  UploadedFile,
  UploadPurpose,
} from '@instasupply/shared';
import type { Actor } from '../auth/actor';
import type { Queryable } from '../db/tx';
import type { RequestContext } from '../http/context';
import { ApiError, invalidArgument, notFound, permissionDenied } from '../http/errors';
import { use, consumeAll } from '../http/rate-limit';
import { isRequestId, newId } from '../ids';
import {
  countScopeFiles,
  findFileById,
  findFileByPath,
  insertFile,
  markFileReady,
  type FileRow,
} from './files.repository';
import {
  extensionFor,
  folderFor,
  isImageType,
  looksLikeImage,
  PUBLIC_PURPOSES,
  UPLOAD_LIMITS,
} from './purposes';

export type { FileRow };

const FORM_TTL_SECONDS = 600;
const DAY_MS = 86_400_000;

type Db = Queryable;

/** `publicOrigin/api/v1/media/<path>`, or null for a null path (§3.3). */
export function mediaUrl(origin: string, path: string | null | undefined): string | null {
  return path ? `${origin}/api/v1/media/${path.split('/').map(encodeURIComponent).join('/')}` : null;
}

const isActiveMember = (actor: Actor, storeId: string): boolean =>
  actor.role === 'supplier' && actor.isActive && actor.storeId === storeId;

/** Who may presign an upload of this purpose for this scope (the "May presign" column). */
async function checkUploadRule(db: Db, actor: Actor, purpose: UploadPurpose, ownerId: string): Promise<void> {
  switch (purpose) {
    case 'proof': {
      const { rows } = await db.query<{ driver_id: string | null }>(
        'SELECT driver_id FROM deliveries WHERE id = $1',
        [ownerId],
      );
      if (!rows[0]) notFound('That delivery does not exist.');
      if (!(actor.role === 'driver' && actor.isActive && rows[0].driver_id === actor.uid)) permissionDenied();
      return;
    }
    case 'quote_upload':
      if (actor.role !== 'customer' || !actor.isActive)
        permissionDenied('Sign in with a customer account to do this.');
      if (!isRequestId(ownerId)) invalidArgument('The request id must be a UUID.');
      return;
    case 'issue_photo': {
      if (actor.role !== 'customer' || !actor.isActive)
        permissionDenied('Sign in with a customer account to do this.');
      if (!isRequestId(ownerId)) invalidArgument('The issue id must be a UUID.');
      const { rows } = await db.query<{ customer_id: string }>(
        'SELECT customer_id FROM issues WHERE id = $1',
        [ownerId],
      );
      if (rows[0] && rows[0].customer_id !== actor.uid) permissionDenied();
      return;
    }
    case 'store_photo':
      if (actor.isStaff || (isActiveMember(actor, ownerId) && actor.storeRole === 'owner')) return;
      permissionDenied();
      return;
    case 'product_photo':
      if (actor.isStaff || isActiveMember(actor, ownerId)) return;
      permissionDenied();
      return;
    case 'avatar':
      if (ownerId !== actor.uid) permissionDenied();
      return;
  }
}

export async function presignUpload(
  ctx: RequestContext,
  actor: Actor,
  input: PresignRequest,
): Promise<PresignedUpload> {
  const { deps } = ctx;
  const limits = UPLOAD_LIMITS[input.purpose];
  await checkUploadRule(deps.pool, actor, input.purpose, input.ownerId);
  await consumeAll(deps, [use('file_ticket', actor.uid)]);
  if (!limits.contentTypes.includes(input.contentType)) {
    invalidArgument('This kind of file is not accepted here.', { fields: { contentType: 'not accepted' } });
  }
  if (input.sizeBytes > limits.maxBytes) {
    invalidArgument(
      `The file is too large. The limit is ${Math.round(limits.maxBytes / (1024 * 1024))} MB.`,
      {
        fields: { sizeBytes: 'too large' },
      },
    );
  }
  const now = deps.clock.now();
  const count = await countScopeFiles(
    deps.pool,
    input.purpose,
    input.ownerId,
    limits.perScope.perDay ? now - DAY_MS : null,
  );
  if (count >= limits.perScope.max) {
    throw new ApiError(
      'resource-exhausted',
      'You have reached the upload limit for this item.',
      'RATE_LIMITED',
      {
        limit: limits.perScope.max,
        ...(limits.perScope.perDay ? { retryAfterMs: DAY_MS } : {}),
      },
    );
  }
  const uploadId = newId();
  const path = `${folderFor(input.purpose, input.ownerId, actor.uid)}/${newId()}.${extensionFor(input.contentType)}`;
  const uploadKey = `uploads/${uploadId}`;
  await insertFile(deps.pool, {
    id: uploadId,
    path,
    upload_key: uploadKey,
    purpose: input.purpose,
    uploaded_by: actor.uid,
    scope_id: input.ownerId,
    content_type: input.contentType,
    max_bytes: limits.maxBytes,
    original_name: input.fileName,
    created_at: now,
  });
  const form = await deps.storage.createUpload({
    uploadId,
    path: uploadKey,
    contentType: input.contentType,
    maxBytes: limits.maxBytes,
    expiresInSeconds: FORM_TTL_SECONDS,
    origin: ctx.origin,
    now,
  });
  return {
    uploadId,
    path,
    method: 'POST',
    url: form.url,
    fields: form.fields,
    headers: {},
    expiresAt: now + FORM_TTL_SECONDS * 1000,
  };
}

const uploadedFile = (row: FileRow): UploadedFile => ({
  path: row.path,
  name: row.original_name ?? row.path.split('/').pop() ?? row.path,
  contentType: row.content_type,
  sizeBytes: row.size_bytes ?? 0,
});

export async function confirmUpload(
  ctx: RequestContext,
  actor: Actor,
  uploadId: string,
): Promise<UploadedFile> {
  const { deps } = ctx;
  const row = await findFileById(deps.pool, uploadId);
  if (!row) notFound('That upload does not exist.');
  if (row.uploaded_by !== actor.uid) permissionDenied();
  if (row.status === 'ready') return uploadedFile(row);

  const stored = await deps.storage.head(row.upload_key);
  if (!stored) invalidArgument('The file was not uploaded. Upload it again.');
  const reject = async (message: string): Promise<never> => {
    await deps.storage.delete(row.upload_key);
    return invalidArgument(message);
  };
  if (stored.sizeBytes <= 0 || stored.sizeBytes > row.max_bytes)
    await reject('The file is empty or too large.');
  if (stored.contentType !== row.content_type)
    await reject('The file type does not match what was announced.');
  if (isImageType(row.content_type) && !looksLikeImage(await deps.storage.readStart(row.upload_key, 32))) {
    await reject('The file is not a JPEG, PNG, WebP or HEIC image.');
  }
  await deps.storage.copy(row.upload_key, row.path);
  const copied = await deps.storage.head(row.path);
  if (!copied || copied.sizeBytes !== stored.sizeBytes) {
    await deps.storage.delete(row.path);
    throw new ApiError('unavailable', 'The upload could not be stored. Please try again.');
  }
  await deps.storage.delete(row.upload_key);
  await markFileReady(deps.pool, row.id, copied.sizeBytes, deps.clock.now());
  return uploadedFile({ ...row, status: 'ready', size_bytes: copied.sizeBytes });
}

/**
 * One indexed read that replaces "exists in Storage, right size, right type, right owner" (§10.1 step 4).
 * Commands call it with the purpose and scope the path must have.
 */
export async function requireReadyFile(
  db: Db,
  path: string,
  expect: { purpose: UploadPurpose; scopeId: string; uploadedBy?: string },
): Promise<FileRow> {
  const row = await findFileByPath(db, path);
  const ok =
    row !== null &&
    row.status === 'ready' &&
    row.purpose === expect.purpose &&
    row.scope_id === expect.scopeId &&
    (expect.uploadedBy === undefined || row.uploaded_by === expect.uploadedBy);
  if (!ok)
    invalidArgument('That file was not uploaded here. Upload it again.', {
      fields: { path: 'not an upload' },
    });
  return row!;
}

/** The "May read" column of §10.1. */
export async function authorizeRead(db: Db, actor: Actor | null, row: FileRow): Promise<boolean> {
  if (PUBLIC_PURPOSES.has(row.purpose)) return true;
  if (!actor || actor.status === 'suspended') return false;
  if (actor.isStaff) return true;
  switch (row.purpose) {
    case 'proof': {
      const { rows } = await db.query<{ driver_id: string | null; customer_id: string | null }>(
        'SELECT driver_id, customer_id FROM deliveries WHERE id = $1',
        [row.scope_id],
      );
      const d = rows[0];
      return !!d && ((actor.role === 'driver' && d.driver_id === actor.uid) || d.customer_id === actor.uid);
    }
    case 'quote_upload':
      return row.uploaded_by === actor.uid;
    case 'issue_photo': {
      if (row.uploaded_by === actor.uid) return true;
      const { rows } = await db.query<{ store_id: string }>('SELECT store_id FROM issues WHERE id = $1', [
        row.scope_id,
      ]);
      return !!rows[0] && isActiveMember(actor, rows[0].store_id);
    }
    default:
      return false;
  }
}

/** GET /files/url: a short-lived URL for a private file the caller may read. */
export async function fileUrl(ctx: RequestContext, actor: Actor, path: string): Promise<FileUrlResponse> {
  const { deps } = ctx;
  const row = await findFileByPath(deps.pool, path);
  if (!row || row.status !== 'ready') notFound('That file does not exist.');
  if (!(await authorizeRead(deps.pool, actor, row))) permissionDenied();
  const now = deps.clock.now();
  const ttl = deps.config.FILE_URL_TTL_SECONDS;
  const url = await deps.storage.signedUrl({
    uploadId: row.id,
    path: row.path,
    expiresInSeconds: ttl,
    // Documents download; images and PDFs open inline.
    disposition:
      isImageType(row.content_type) || row.content_type === 'application/pdf' ? 'inline' : 'attachment',
    fileName: row.original_name ?? undefined,
    origin: ctx.origin,
    now,
  });
  return { url, expiresAt: now + ttl * 1000 };
}
