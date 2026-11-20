/**
 * Every SQL statement on `favorites`, `carts`, the "Buy again" rail and the profile fields a user edits
 * (docs/PLATFORM.md §3.3, §5.3.3). Favourites have no foreign key: a favourite may outlive the listing.
 */
import type { Cart, CartInput, Favorite, Product, UserPreferences, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';
import { mediaUrl } from '../../platform/storage/files.service';

export const MAX_FAVORITES = 500;

interface FavoriteRow {
  product_id: string;
  created_at: number;
}

const toFavorite = (row: FavoriteRow): WithId<Favorite> => ({
  id: row.product_id,
  productId: row.product_id,
  createdAt: row.created_at,
});

/** Newest first, keyset on (created_at, product_id). `limit + 1` rows so the caller can build the page. */
export async function listFavorites(
  db: Queryable,
  userId: string,
  limit: number,
  after: { createdAt: number; productId: string } | null,
): Promise<{ items: WithId<Favorite>[]; rows: FavoriteRow[] }> {
  const params: unknown[] = [userId, limit + 1];
  let where = 'user_id = $1';
  if (after) {
    params.push(new Date(after.createdAt), after.productId);
    where += ' AND (created_at, product_id) < ($3, $4)';
  }
  const { rows } = await db.query<FavoriteRow>(
    `SELECT product_id, created_at FROM favorites WHERE ${where}
      ORDER BY created_at DESC, product_id DESC LIMIT $2`,
    params,
  );
  return { items: rows.map(toFavorite), rows };
}

export const favoriteKey = (favorite: WithId<Favorite>): [number, string] => [
  favorite.createdAt,
  favorite.productId,
];

/** Idempotent. Returns false when the user is at the cap and the favourite is new. */
export async function addFavorite(tx: Tx, userId: string, productId: string): Promise<boolean> {
  const { rows } = await tx.query<{ n: number; mine: boolean }>(
    `SELECT count(*)::int AS n, bool_or(product_id = $2) AS mine FROM favorites WHERE user_id = $1`,
    [userId, productId],
  );
  const state = rows[0];
  if (state?.mine) return true;
  if ((state?.n ?? 0) >= MAX_FAVORITES) return false;
  await tx.query(
    `INSERT INTO favorites (user_id, product_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO NOTHING`,
    [userId, productId, new Date(tx.now)],
  );
  return true;
}

export async function removeFavorite(db: Queryable, userId: string, productId: string): Promise<void> {
  await db.query('DELETE FROM favorites WHERE user_id = $1 AND product_id = $2', [userId, productId]);
}

// ---------- carts (P1) ----------

export async function findCart(db: Queryable, userId: string): Promise<Cart | null> {
  const { rows } = await db.query<{ doc: CartInput; updated_at: number }>(
    'SELECT doc, updated_at FROM carts WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  return row ? { ...row.doc, updatedAt: row.updated_at } : null;
}

export async function saveCart(db: Queryable, userId: string, cart: CartInput, now: number): Promise<Cart> {
  await db.query(
    `INSERT INTO carts (user_id, doc, updated_at) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (user_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
    [userId, JSON.stringify(cart), new Date(now)],
  );
  return { ...cart, updatedAt: now };
}

export async function deleteCart(db: Queryable, userId: string): Promise<void> {
  await db.query('DELETE FROM carts WHERE user_id = $1', [userId]);
}

// ---------- buy again ----------

interface ProductRow {
  id: string;
  store_id: string;
  doc: Omit<
    Product,
    | 'id'
    | 'storeId'
    | 'stockOnHand'
    | 'reserved'
    | 'listed'
    | 'storeName'
    | 'storeStatus'
    | 'searchTerms'
    | 'imageUrl'
    | 'createdAt'
    | 'updatedAt'
  >;
  stock_on_hand: number;
  reserved: number;
  listed: boolean;
  store_name: string;
  store_status: Product['storeStatus'];
  search_terms: string[];
  created_at: number;
  updated_at: number;
}

/** The composition of §3.3 for `products`. */
const toProduct = (row: ProductRow, origin: string): Product => ({
  ...row.doc,
  id: row.id,
  storeId: row.store_id,
  stockOnHand: row.stock_on_hand,
  reserved: row.reserved,
  listed: row.listed,
  storeName: row.store_name,
  storeStatus: row.store_status,
  searchTerms: row.search_terms,
  imageUrl: mediaUrl(origin, row.doc.imagePath ?? null),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * The Home rail (MARKETPLACE §7.3): the listed products of the caller's last 10 orders, most ordered first
 * (in how many of those orders, then how many units), at most 12.
 */
export async function buyAgain(db: Queryable, userId: string, origin: string): Promise<Product[]> {
  const { rows } = await db.query<ProductRow>(
    `WITH recent AS (
       SELECT id FROM orders WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10
     ), bought AS (
       SELECT line->>'productId' AS product_id, so.order_id, (line->>'quantity')::int AS quantity
         FROM store_orders so
         JOIN recent r ON r.id = so.order_id
         CROSS JOIN LATERAL jsonb_array_elements(so.doc->'lines') AS line
        WHERE line->>'kind' = 'catalog' AND line->>'productId' IS NOT NULL
     ), ranked AS (
       SELECT product_id, count(DISTINCT order_id) AS orders, sum(quantity) AS units FROM bought GROUP BY product_id
     )
     SELECT p.id, p.store_id, p.doc, p.stock_on_hand, p.reserved, p.listed, p.store_name, p.store_status,
            p.search_terms, p.created_at, p.updated_at
       FROM ranked k JOIN products p ON p.id = k.product_id
      WHERE p.listed
      ORDER BY k.orders DESC, k.units DESC, p.id
      LIMIT 12`,
    [userId],
  );
  return rows.map((row) => toProduct(row, origin));
}

// ---------- the profile fields a user edits (PATCH /me) ----------

export interface ProfileUpdate {
  displayName?: string;
  photoPath?: string | null;
  preferences?: Partial<UserPreferences>;
  companyName?: string | null;
  accountType?: string | null;
}

/** Locks the user row, merges `preferences`, writes the other keys of `doc` and the name; publishes user:{uid}. */
export async function updateProfile(tx: Tx, userId: string, patch: ProfileUpdate): Promise<void> {
  const { rows } = await tx.query<{ role: string | null; doc: { preferences?: UserPreferences } }>(
    'SELECT role, doc FROM users WHERE id = $1 FOR NO KEY UPDATE',
    [userId],
  );
  const user = rows[0];
  if (!user) return;
  const docPatch: Record<string, unknown> = {};
  if (patch.photoPath !== undefined) docPatch.photoPath = patch.photoPath;
  if (patch.companyName !== undefined) docPatch.companyName = patch.companyName;
  if (patch.accountType !== undefined) docPatch.accountType = patch.accountType;
  if (patch.preferences !== undefined) {
    docPatch.preferences = { ...(user.doc.preferences ?? {}), ...patch.preferences };
  }
  await tx.query(
    `UPDATE users SET display_name = COALESCE($2, display_name), doc = doc || $3::jsonb, updated_at = $4
      WHERE id = $1`,
    [userId, patch.displayName ?? null, JSON.stringify(docPatch), new Date(tx.now)],
  );
  await publishChange(tx, 'users', 'updated', { uid: userId, role: user.role });
}
