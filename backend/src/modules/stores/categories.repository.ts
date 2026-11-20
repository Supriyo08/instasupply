/** SQL of the `categories` table and its row ↔ document mapping (docs/PLATFORM.md §3.1, §3.3). */
import type { Category, CategoryId } from '@instasupply/shared';
import { lockRows } from '../../platform/db/locks';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

export interface CategoryRow {
  id: string;
  doc: Omit<Category, 'id'>;
  created_at: number;
  updated_at: number;
}

const COLUMNS = 'id, doc, created_at, updated_at';

export const toCategory = (row: CategoryRow): Category => ({ ...row.doc, id: row.id as CategoryId });

export async function listCategories(
  db: Queryable,
  after: { sortOrder: number; id: string } | null,
  limit: number,
): Promise<CategoryRow[]> {
  const { rows } = after
    ? await db.query<CategoryRow>(
        `SELECT ${COLUMNS} FROM categories WHERE (sort_order, id) > ($1, $2) ORDER BY sort_order, id LIMIT $3`,
        [after.sortOrder, after.id, limit + 1],
      )
    : await db.query<CategoryRow>(`SELECT ${COLUMNS} FROM categories ORDER BY sort_order, id LIMIT $1`, [
        limit + 1,
      ]);
  return rows;
}

export async function findCategory(db: Queryable, id: string): Promise<CategoryRow | null> {
  const { rows } = await db.query<CategoryRow>(`SELECT ${COLUMNS} FROM categories WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Statement (a) of §3.5 on `categories` (rank 9). */
export async function lockCategories(
  tx: Tx,
  ids: readonly string[],
  mode: 'update' | 'share' = 'update',
): Promise<Map<string, CategoryRow>> {
  const rows = await lockRows<CategoryRow>(tx, 'categories', ids, mode);
  return new Map(rows.map((row) => [row.id, row]));
}

/** Every category, locked in id order (the reorder rewrites them all). */
export async function lockAllCategories(tx: Tx): Promise<CategoryRow[]> {
  const { rows } = await tx.query<CategoryRow>(
    `SELECT ${COLUMNS} FROM categories ORDER BY id COLLATE "C" FOR NO KEY UPDATE`,
  );
  return rows;
}

/** Insert or replace a category document. The caller holds the row lock when the row exists. */
export async function upsertCategory(tx: Tx, category: Category, existed: boolean): Promise<Category> {
  const { id, ...doc } = category;
  await tx.query(
    `INSERT INTO categories (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
    [id, JSON.stringify(doc), new Date(tx.now)],
  );
  await publishChange(tx, 'categories', existed ? 'updated' : 'created', category);
  return category;
}

export async function deleteCategory(tx: Tx, id: string): Promise<void> {
  await tx.query('DELETE FROM categories WHERE id = $1', [id]);
  await publishChange(tx, 'categories', 'deleted', { id });
}

/** Does any product, listed or not, use the category? (the foreign key would refuse the delete as well) */
export async function categoryInUse(tx: Tx, id: string): Promise<boolean> {
  const { rows } = await tx.query<{ ok: number }>(
    'SELECT 1 AS ok FROM products WHERE category_id = $1 LIMIT 1',
    [id],
  );
  return rows.length > 0;
}
