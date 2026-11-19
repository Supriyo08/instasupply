/** Keyset pagination (docs/PLATFORM.md §4.4): opaque cursors, limit + 1 rows, no totals. */
import type { Page } from '@instasupply/shared';
import { z } from 'zod';
import { invalidArgument } from './errors';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(500).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export type CursorValue = string | number | boolean | null;

export function encodeCursor(sortValue: CursorValue, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString('base64url');
}

export function decodeCursor(cursor: string): [CursorValue, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[1] === 'string' &&
      (value[0] === null || ['string', 'number', 'boolean'].includes(typeof value[0]))
    ) {
      return [value[0] as CursorValue, value[1]];
    }
  } catch {
    // fall through: any cursor that does not parse is the caller's mistake
  }
  return invalidArgument('That page cursor is not valid. Reload the list.');
}

/**
 * Builds a page from `limit + 1` rows read in sort order. `key` gives the sort value and id of a row, which
 * become the next cursor.
 */
export function readPage<R, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
  key: (row: R) => [CursorValue, string],
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(map),
    nextCursor: hasMore && last !== undefined ? encodeCursor(...key(last)) : null,
  };
}
