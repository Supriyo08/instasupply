/** SQL of `store_suggestions` (docs/PLATFORM.md §3.3): typed columns only, read by staff. */
import type { StoreSuggestion, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Status = StoreSuggestion['status'];

interface SuggestionRow {
  id: string;
  store_name: string;
  city: string;
  interests: string[];
  email: string | null;
  suggested_by: string | null;
  source: 'app' | 'web';
  status: Status;
  created_at: number;
  updated_at: number;
}

const COLUMNS =
  'id, store_name, city, interests, email, suggested_by, source, status, created_at, updated_at';

export const toStoreSuggestion = (row: SuggestionRow): WithId<StoreSuggestion> => ({
  id: row.id,
  storeName: row.store_name,
  city: row.city,
  interests: row.interests,
  email: row.email,
  suggestedBy: row.suggested_by,
  source: row.source,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const suggestionCursorKey = (row: SuggestionRow): [number, string] => [row.created_at, row.id];

export async function insertSuggestion(tx: Tx, suggestion: WithId<StoreSuggestion>): Promise<void> {
  await tx.query(
    `INSERT INTO store_suggestions (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      suggestion.id,
      suggestion.storeName,
      suggestion.city,
      suggestion.interests,
      suggestion.email,
      suggestion.suggestedBy,
      suggestion.source,
      suggestion.status,
      new Date(suggestion.createdAt),
      new Date(suggestion.updatedAt),
    ],
  );
  await publishChange(tx, 'store_suggestions', 'created', { id: suggestion.id });
}

/** GET /store-suggestions: newest first (index 34 with a status, the primary order otherwise). */
export async function listSuggestions(
  db: Queryable,
  status: Status | null,
  after: [number, string] | null,
  limit: number,
): Promise<SuggestionRow[]> {
  const { rows } = await db.query<SuggestionRow>(
    `SELECT ${COLUMNS} FROM store_suggestions
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
      ORDER BY created_at DESC, id DESC LIMIT $4`,
    [status, after ? new Date(after[0]) : null, after ? after[1] : null, limit + 1],
  );
  return rows;
}

/** Only `status` can change. Answers the saved row, or null when there is none. */
export async function setSuggestionStatus(
  tx: Tx,
  id: string,
  status: Status,
): Promise<WithId<StoreSuggestion> | null> {
  const { rows } = await tx.query<SuggestionRow>(
    `UPDATE store_suggestions SET status = $2, updated_at = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status, new Date(tx.now)],
  );
  const row = rows[0];
  if (!row) return null;
  await publishChange(tx, 'store_suggestions', 'updated', { id });
  return toStoreSuggestion(row);
}
