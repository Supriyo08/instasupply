/**
 * The Railway bucket through the S3 API (production). Buckets are private, so every read goes through a
 * signed URL, and uploads are presigned POST forms whose conditions pin the key, the content type and the
 * size: the API never sees the bytes.
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../../config/env';
import type { Storage } from './storage';

const DAY_MS = 86_400_000;

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/** RFC 6266 filename for Content-Disposition; non-ASCII names travel in filename*. */
function disposition(kind: 'inline' | 'attachment', fileName: string | undefined): string {
  if (!fileName) return kind;
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createS3Storage(config: Config): Storage {
  const bucket = config.S3_BUCKET!;
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT!,
    region: config.S3_REGION!,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! },
  });

  return {
    driver: 's3',
    async createUpload({ path, contentType, maxBytes, expiresInSeconds }) {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: bucket,
        Key: path,
        Conditions: [
          { bucket },
          ['eq', '$key', path],
          ['eq', '$Content-Type', contentType],
          ['content-length-range', 1, maxBytes],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: expiresInSeconds,
      });
      return { url, fields };
    },
    async head(path) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
        return {
          sizeBytes: out.ContentLength ?? 0,
          contentType: out.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async readStart(path, bytes) {
      const out = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: path, Range: `bytes=0-${bytes - 1}` }),
      );
      const body = out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
      return Buffer.from(body);
    },
    async signedUrl({ path, expiresInSeconds, stable, disposition: kind = 'inline', fileName, now }) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: path,
        ResponseContentDisposition: disposition(kind, fileName),
      });
      // A stable URL is signed at the start of the UTC day and lives 2 days: every request that day yields
      // the same URL, so browser and CDN caches hit.
      return stable
        ? getSignedUrl(client, command, {
            expiresIn: 2 * 86_400,
            signingDate: new Date(Math.floor(now / DAY_MS) * DAY_MS),
          })
        : getSignedUrl(client, command, { expiresIn: expiresInSeconds, signingDate: new Date(now) });
    },
    async copy(fromKey, toKey) {
      await client.send(
        new CopyObjectCommand({ Bucket: bucket, Key: toKey, CopySource: `${bucket}/${encodeURI(fromKey)}` }),
      );
    },
    async put(path, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: path, Body: body, ContentType: contentType }),
      );
    },
    async delete(path) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
    },
    async setCors(origins) {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: origins,
                AllowedMethods: ['POST', 'PUT'],
                AllowedHeaders: ['*'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        }),
      );
    },
  };
}
