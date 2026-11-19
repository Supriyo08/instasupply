/** The Storage interface (docs/PLATFORM.md §10.1) and its factory. Both drivers answer the same upload form. */
import type { Config } from '../../config/env';
import { createLocalStorage } from './local-driver';
import { createS3Storage } from './s3-driver';

export interface Storage {
  readonly driver: 'local' | 's3';
  /** A form the client POSTs the file to. The driver enforces the exact key, the content type and the size. */
  createUpload(input: {
    uploadId: string;
    path: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
    /** publicOrigin(req): the local driver's upload target is this API. */
    origin: string;
    /** The command's clock: expiries are computed from it, so tests with a FakeClock see them expire. */
    now: number;
  }): Promise<{ url: string; fields: Record<string, string> }>;
  /** Metadata of a stored object, or null when it does not exist. */
  head(path: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  /** The first `bytes` bytes, for the magic-number check. */
  readStart(path: string, bytes: number): Promise<Buffer>;
  /** A URL that serves the object without further credentials until it expires. */
  signedUrl(input: {
    uploadId: string;
    path: string;
    expiresInSeconds: number;
    stable?: boolean;
    disposition?: 'inline' | 'attachment';
    fileName?: string;
    /** publicOrigin(req): the local driver serves files from this API. */
    origin: string;
    now: number;
  }): Promise<string>;
  /** Server-side copy inside the store (S3 CopyObject; a copy on disk for the local driver). */
  copy(fromKey: string, toKey: string): Promise<void>;
  /** Server-side write (seed, tests, the local upload target). */
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  delete(path: string): Promise<void>;
  /** `storage-cors` CLI command. A no-op for the local driver. */
  setCors(origins: string[]): Promise<void>;
  /** The local driver only: a readable stream of the object, for GET /files/local and /media. */
  open?(path: string): Promise<NodeJS.ReadableStream | null>;
}

export function createStorage(config: Config): Storage {
  return config.STORAGE_DRIVER === 's3' ? createS3Storage(config) : createLocalStorage(config);
}
