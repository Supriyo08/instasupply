/** File endpoints (docs/PLATFORM.md §5.3.9). */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../container';
import { requireAuth } from '../auth/policies';
import { invalidArgument, notFound, permissionDenied } from '../http/errors';
import { defineRoute, idParam } from '../http/route';
import { checkFileSignature, checkUploadToken } from './local-driver';
import { findFileById, findFileByPath } from './files.repository';
import { confirmUpload, fileUrl, presignUpload } from './files.service';
import { PUBLIC_PURPOSES, UPLOAD_PURPOSES } from './purposes';

const presignSchema = z
  .object({
    purpose: z
      .enum(UPLOAD_PURPOSES as [string, ...string[]])
      .transform((v) => v as (typeof UPLOAD_PURPOSES)[number]),
    ownerId: z.string().trim().min(1).max(100),
    fileName: z.string().trim().min(1).max(200),
    contentType: z.string().trim().toLowerCase().min(1).max(120),
    sizeBytes: z.number().int().min(1),
  })
  .strict();

const MEDIA_CACHE = 'public, max-age=3600';

async function sendLocal(deps: Deps, reply: FastifyReply, path: string, contentType: string, cache: string) {
  const stream = deps.storage.open ? await deps.storage.open(path) : null;
  if (!stream) notFound('That file does not exist.');
  return reply
    .header('Content-Type', contentType)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Cache-Control', cache)
    .send(stream);
}

export function registerFileRoutes(app: FastifyInstance, deps: Deps): void {
  defineRoute(app, {
    method: 'POST',
    url: '/files/presign',
    policy: requireAuth,
    body: presignSchema,
    handler: (ctx, { body }, actor) => presignUpload(ctx, actor!, body),
  });

  defineRoute(app, {
    method: 'POST',
    url: '/files/confirm',
    policy: requireAuth,
    body: z.object({ uploadId: z.string().uuid() }).strict(),
    handler: (ctx, { body }, actor) => confirmUpload(ctx, actor!, body.uploadId),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/files/url',
    policy: requireAuth,
    query: z.object({ path: z.string().min(1).max(300) }),
    handler: (ctx, { query }, actor) => fileUrl(ctx, actor!, query.path),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/media/*',
    policy: 'public',
    handler: async (ctx, _input, _actor, request, reply) => {
      const path = decodeURIComponent((request.params as { '*': string })['*'] ?? '');
      const row = path ? await findFileByPath(deps.pool, path) : null;
      // Always not-found, also for private files: the media path proves nothing about who may read it.
      if (!row || row.status !== 'ready' || !PUBLIC_PURPOSES.has(row.purpose))
        notFound('That file does not exist.');
      if (deps.storage.driver === 'local')
        return sendLocal(deps, reply, row.path, row.content_type, MEDIA_CACHE);
      const url = await deps.storage.signedUrl({
        uploadId: row.id,
        path: row.path,
        expiresInSeconds: 2 * 86_400,
        stable: true,
        origin: ctx.origin,
        now: deps.clock.now(),
      });
      return reply.header('Cache-Control', MEDIA_CACHE).redirect(url, 302);
    },
  });

  if (deps.storage.driver !== 'local') return;

  // The upload target of the local driver: the form's token is the credential, as a presigned form is.
  defineRoute(app, {
    method: 'POST',
    url: '/files/local/:uploadId',
    policy: 'public',
    params: z.object({ uploadId: idParam }),
    status: 204,
    handler: async (_ctx, { params }, _actor, request) => {
      const row = await findFileById(deps.pool, params.uploadId);
      if (!row || row.status !== 'pending') notFound('That upload does not exist.');
      const file = await request.file({ limits: { fileSize: row.max_bytes, files: 1, fields: 5 } });
      if (!file) invalidArgument('Attach the file as the last part, named "file".');
      const token = (file.fields.token as { value?: unknown } | undefined)?.value;
      if (typeof token !== 'string' || !checkUploadToken(row.id, token, deps.clock.now())) {
        permissionDenied('This upload form has expired. Start the upload again.');
      }
      if (file.fieldname !== 'file') invalidArgument('Attach the file as the last part, named "file".');
      if (file.mimetype !== row.content_type)
        invalidArgument('The file type does not match what was announced.');
      const body = await file.toBuffer();
      if (body.length === 0) invalidArgument('The file is empty.');
      await deps.storage.put(row.upload_key, body, file.mimetype);
      return undefined;
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/files/local/:uploadId',
    policy: 'public',
    params: z.object({ uploadId: idParam }),
    query: z.object({ exp: z.coerce.number().int(), sig: z.string().max(64) }),
    handler: async (_ctx, { params, query }, _actor, _request, reply) => {
      const valid = checkFileSignature(params.uploadId, query.exp, query.sig, deps.clock.now());
      const row = valid ? await findFileById(deps.pool, params.uploadId) : null;
      if (!row || row.status !== 'ready') notFound('That file does not exist or the link has expired.');
      return sendLocal(deps, reply, row.path, row.content_type, 'private, max-age=300');
    },
  });
}
