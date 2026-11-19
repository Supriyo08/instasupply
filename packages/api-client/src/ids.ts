/**
 * Client-generated ids (decision D17): checkoutId, requestId, issueId, message ids and upload ids are
 * UUIDv4s made on the device, so a repeated request is recognised by the server as the same one.
 */
export function newRequestId(randomUUID: () => string): string {
  return randomUUID();
}

/** Stable, human-diffable JSON for query keys: object keys sorted, `undefined` left out. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = sortKeys(item);
    }
    return out;
  }
  return value;
}
