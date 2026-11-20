/**
 * Remembers the uploaded storage path of each proof photo (per delivery and photo URI), so a retried
 * Complete (a wrong hand-off code, a network failure) sends the same path again instead of compressing
 * and uploading the photo once more. A new photo has a new URI; `forget` drops a path the server refused
 * (`PHOTO_REQUIRED`). Concurrent calls for the same photo share one upload; a failed upload is not kept.
 */
export interface ProofUploadCache {
  pathFor(deliveryId: string, uri: string): Promise<string>;
  forget(deliveryId: string): void;
}

export function createProofUploadCache(
  upload: (deliveryId: string, uri: string) => Promise<string>,
): ProofUploadCache {
  const entries = new Map<string, { uri: string; path: Promise<string> }>();
  return {
    pathFor(deliveryId, uri) {
      const known = entries.get(deliveryId);
      if (known && known.uri === uri) return known.path;
      const path = upload(deliveryId, uri);
      const entry = { uri, path };
      entries.set(deliveryId, entry);
      path.catch(() => {
        if (entries.get(deliveryId) === entry) entries.delete(deliveryId);
      });
      return path;
    },
    forget(deliveryId) {
      entries.delete(deliveryId);
    },
  };
}
