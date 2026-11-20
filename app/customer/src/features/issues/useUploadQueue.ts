import {
  describeError,
  validateUpload,
  type UploadPurpose,
  type UploadSource,
} from '@instasupply/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

export interface QueuedFile {
  key: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** For a thumbnail: the file URI, or an object URL on the web. */
  previewUri: string | null;
  status: 'uploading' | 'done' | 'failed';
  path: string | null;
  error: string | null;
  source: UploadSource;
}

function previewOf(source: UploadSource): string | null {
  if (source.kind === 'uri') return source.uri;
  if (Platform.OS === 'web' && typeof URL !== 'undefined') return URL.createObjectURL(source.blob);
  return null;
}

const sizeOf = (source: UploadSource) => (source.kind === 'blob' ? source.blob.size : source.sizeBytes);

/**
 * Uploads picked files at once (`api.upload`: presign, send, confirm) so the form can send their paths
 * (issue photos under the issue id, material-list files under the request id). Failed files keep their
 * error and can be retried or removed; nothing is sent until every file is done.
 */
export function useUploadQueue(purpose: UploadPurpose, ownerId: string, max: number) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const counter = useRef(0);
  const filesRef = useRef(files);
  filesRef.current = files;

  // Object URLs live until the form goes away.
  useEffect(
    () => () => {
      if (Platform.OS !== 'web') return;
      for (const file of filesRef.current) {
        if (file.source.kind === 'blob' && file.previewUri) URL.revokeObjectURL(file.previewUri);
      }
    },
    [],
  );

  const patch = useCallback((key: string, change: Partial<QueuedFile>) => {
    setFiles((current) => current.map((file) => (file.key === key ? { ...file, ...change } : file)));
  }, []);

  const upload = useCallback(
    async (key: string, source: UploadSource) => {
      patch(key, { status: 'uploading', error: null });
      try {
        const uploaded = await api.upload({ purpose, ownerId, source });
        patch(key, { status: 'done', path: uploaded.path, name: uploaded.name });
      } catch (error) {
        patch(key, { status: 'failed', error: describeError(error, "Couldn't upload this file.") });
      }
    },
    [ownerId, patch, purpose],
  );

  /** Adds picked files up to `max`; returns the first local problem (type or size), if any. */
  const add = useCallback(
    (sources: readonly UploadSource[]): string | null => {
      const room = Math.max(0, max - filesRef.current.length);
      let problem: string | null = sources.length > room ? `You can add up to ${max} files.` : null;
      const accepted: QueuedFile[] = [];
      for (const source of sources.slice(0, room)) {
        const invalid = validateUpload(purpose, source);
        if (invalid) {
          problem ??= invalid;
          continue;
        }
        counter.current += 1;
        accepted.push({
          key: `file-${counter.current}`,
          name: source.name,
          contentType: source.contentType,
          sizeBytes: sizeOf(source),
          previewUri: previewOf(source),
          status: 'uploading',
          path: null,
          error: null,
          source,
        });
      }
      if (accepted.length > 0) {
        setFiles((current) => [...current, ...accepted]);
        for (const file of accepted) void upload(file.key, file.source);
      }
      return problem;
    },
    [max, purpose, upload],
  );

  const retry = useCallback(
    (key: string) => {
      const file = filesRef.current.find((entry) => entry.key === key);
      if (file) void upload(key, file.source);
    },
    [upload],
  );

  const remove = useCallback((key: string) => {
    setFiles((current) => {
      const file = current.find((entry) => entry.key === key);
      if (Platform.OS === 'web' && file?.source.kind === 'blob' && file.previewUri) {
        URL.revokeObjectURL(file.previewUri);
      }
      return current.filter((entry) => entry.key !== key);
    });
  }, []);

  const uploading = files.some((file) => file.status === 'uploading');
  const failed = files.some((file) => file.status === 'failed');
  return { files, add, retry, remove, uploading, failed, full: files.length >= max };
}
