/**
 * Every SQL statement on `cards` (docs/PLATFORM.md §3.3, §5.3.3). No column can hold a card number or a CVV;
 * `provider` and `provider_ref` never leave the server. The default flag moves like a jobsite's (statement (n)).
 */
import type { CardBrand, SavedCard } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';

interface CardRow {
  id: string;
  user_id: string;
  brand: CardBrand;
  last4: string;
  exp_month: number;
  exp_year: number;
  holder: string;
  is_default: boolean;
  created_at: number;
}

const COLUMNS = 'id, user_id, brand, last4, exp_month, exp_year, holder, is_default, created_at';

export const MAX_CARDS = 10;

export const toSavedCard = (row: CardRow): SavedCard => ({
  id: row.id,
  brand: row.brand,
  last4: row.last4,
  expMonth: row.exp_month,
  expYear: row.exp_year,
  holder: row.holder,
  isDefault: row.is_default,
  createdAt: row.created_at,
});

export async function listCards(db: Queryable, userId: string): Promise<SavedCard[]> {
  const { rows } = await db.query<CardRow>(
    `SELECT ${COLUMNS} FROM cards WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC, id`,
    [userId],
  );
  return rows.map(toSavedCard);
}

export async function findCard(db: Queryable, id: string): Promise<(SavedCard & { userId: string }) | null> {
  const { rows } = await db.query<CardRow>(`SELECT ${COLUMNS} FROM cards WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? { ...toSavedCard(row), userId: row.user_id } : null;
}

export async function countCards(tx: Tx, userId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM cards WHERE user_id = $1', [
    userId,
  ]);
  return rows[0]?.n ?? 0;
}

export interface CardFields {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
}

/** The owner's row must be locked (statement (n)). Null when the id belongs to another user. */
export async function upsertCard(
  tx: Tx,
  userId: string,
  id: string,
  card: CardFields,
  isDefault: boolean,
): Promise<SavedCard | null> {
  if (isDefault) {
    await tx.query(
      'UPDATE cards SET is_default = false, updated_at = $3 WHERE user_id = $1 AND is_default AND id <> $2',
      [userId, id, new Date(tx.now)],
    );
  }
  const { rows } = await tx.query<CardRow>(
    `INSERT INTO cards (id, user_id, brand, last4, exp_month, exp_year, holder, is_default, provider, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test', $9, $9)
     ON CONFLICT (id) DO UPDATE SET brand = EXCLUDED.brand, last4 = EXCLUDED.last4, exp_month = EXCLUDED.exp_month,
       exp_year = EXCLUDED.exp_year, holder = EXCLUDED.holder, is_default = EXCLUDED.is_default,
       updated_at = EXCLUDED.updated_at
       WHERE cards.user_id = EXCLUDED.user_id
     RETURNING ${COLUMNS}`,
    [
      id,
      userId,
      card.brand,
      card.last4,
      card.expMonth,
      card.expYear,
      card.holder,
      isDefault,
      new Date(tx.now),
    ],
  );
  if (!rows[0]) return null;
  await ensureDefault(tx, userId);
  const { rows: fresh } = await tx.query<CardRow>(`SELECT ${COLUMNS} FROM cards WHERE id = $1`, [id]);
  return fresh[0] ? toSavedCard(fresh[0]) : null;
}

async function ensureDefault(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    `UPDATE cards SET is_default = true, updated_at = $2
      WHERE id = (SELECT id FROM cards WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM cards WHERE user_id = $1 AND is_default)`,
    [userId, new Date(tx.now)],
  );
}

export async function deleteCard(tx: Tx, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await tx.query('DELETE FROM cards WHERE id = $1 AND user_id = $2', [id, userId]);
  if (rowCount === 0) return false;
  await ensureDefault(tx, userId);
  return true;
}
