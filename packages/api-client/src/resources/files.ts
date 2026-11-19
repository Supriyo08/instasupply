import type { FileUrlResponse, PresignedUpload, PresignRequest, UploadedFile } from '../contract';

import type { ResourceContext } from './context';

export const filePaths = {
  presign: '/files/presign',
  confirm: '/files/confirm',
  url: '/files/url',
} as const;

export function createFiles(ctx: ResourceContext) {
  return {
    presign: (request: PresignRequest) => ctx.rest.post<PresignedUpload>(filePaths.presign, request),
    confirm: (uploadId: string) => ctx.rest.post<UploadedFile>(filePaths.confirm, { uploadId }),
    /** A short-lived URL for a private file; `useFileUrl` caches it until a minute before `expiresAt`. */
    url: (path: string, options?: { signal?: AbortSignal }) =>
      ctx.rest.get<FileUrlResponse>(filePaths.url, { query: { path }, signal: options?.signal }),
  };
}
