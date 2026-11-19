/**
 * Files on disk under STORAGE_LOCAL_DIR (development and tests). The API itself is the upload target
 * (POST /files/local/{uploadId}) and serves the files through signed URLs, so clients use the same flow as
 * with the bucket. Content types live in a sidecar `.meta.json`: a file system has no metadata of its own.
 */
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../../config/env';
import { hmacHex, safeEqualHex } from '../crypto';
import type { Storage } from './storage';

/** `uploads/x/../../etc` must never leave the root. */
function resolveInside(root: string, key: string): string {
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep))
    throw new Error(`storage key outside the root: ${key}`);
  return full;
}

const metaPath = (file: string): string => `${file}.meta.json`;

export const uploadTokenFor = (uploadId: string, expiresAt: number): string =>
  `${expiresAt}.${hmacHex('upload', `${uploadId}:${expiresAt}`)}`;

/** The form token of the local upload target: expiry + HMAC, checked against the clock. */
export function checkUploadToken(uploadId: string, token: string, now: number): boolean {
  const match = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  return expiresAt > now && safeEqualHex(match[2]!, hmacHex('upload', `${uploadId}:${expiresAt}`));
}

export const fileSignature = (uploadId: string, exp: number): string => hmacHex('file', `${uploadId}:${exp}`);

export function checkFileSignature(uploadId: string, exp: number, sig: string, now: number): boolean {
  return (
    Number.isSafeInteger(exp) &&
    exp > now &&
    /^[0-9a-f]{64}$/.test(sig) &&
    safeEqualHex(sig, fileSignature(uploadId, exp))
  );
}

export function createLocalStorage(config: Pick<Config, 'STORAGE_LOCAL_DIR'>): Storage {
  const root = path.resolve(config.STORAGE_LOCAL_DIR);

  return {
    driver: 'local',
    async createUpload({ uploadId, expiresInSeconds, origin, now }) {
      const expiresAt = now + expiresInSeconds * 1000;
      return {
        url: `${origin}/api/v1/files/local/${uploadId}`,
        fields: { token: uploadTokenFor(uploadId, expiresAt) },
      };
    },
    async head(key) {
      const file = resolveInside(root, key);
      try {
        const [info, meta] = await Promise.all([stat(file), readFile(metaPath(file), 'utf8')]);
        const { contentType } = JSON.parse(meta) as { contentType: string };
        return info.isFile() ? { sizeBytes: info.size, contentType } : null;
      } catch {
        return null;
      }
    },
    async readStart(key, bytes) {
      const handle = await open(resolveInside(root, key), 'r');
      try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    async signedUrl({ uploadId, expiresInSeconds, stable, origin, now }) {
      // A stable URL changes once a day, so caches can keep the media they already have.
      const exp = stable
        ? Math.floor(now / 86_400_000) * 86_400_000 + 2 * 86_400_000
        : now + expiresInSeconds * 1000;
      return `${origin}/api/v1/files/local/${uploadId}?exp=${exp}&sig=${fileSignature(uploadId, exp)}`;
    },
    async copy(fromKey, toKey) {
      const from = resolveInside(root, fromKey);
      const to = resolveInside(root, toKey);
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
      await copyFile(metaPath(from), metaPath(to));
    },
    async put(key, body, contentType) {
      const file = resolveInside(root, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(metaPath(file), JSON.stringify({ contentType }));
    },
    async delete(key) {
      const file = resolveInside(root, key);
      await rm(file, { force: true });
      await rm(metaPath(file), { force: true });
    },
    async setCors() {
      // The API's own CORS covers the local upload target.
    },
    async open(key) {
      const file = resolveInside(root, key);
      try {
        const info = await stat(file);
        return info.isFile() ? createReadStream(file) : null;
      } catch {
        return null;
      }
    },
  };
}
