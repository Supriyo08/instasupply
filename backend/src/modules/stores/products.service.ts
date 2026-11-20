/**
 * Product writes (docs/PLATFORM.md §5.3.4, MARKETPLACE §6.3 products): staff, or an active member of the
 * store in the product id. The server sets `reserved`, `listed`, `searchTerms`, `storeName`, `storeStatus`,
 * `imageUrl` and `updatedBy`; a supplier never sets `featured`, `badge` or `familyKey`.
 *
 * Locks (§9.2.13): stores FOR SHARE (rank 8) → categories FOR SHARE (rank 9) → products (rank 10). A store
 * rename takes the store row FOR NO KEY UPDATE, so it waits for a product write in progress (and the other way
 * round), and the copied store name on the product is never stale.
 */
import {
  productIdFor,
  validateProduct,
  type CategoryId,
  type Product,
  type ProductInput,
  type ProductPatch,
  type RestProductInput,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { RetryTransaction, withTransaction, type Tx } from '../../platform/db/tx';
import {
  fail,
  failedPrecondition,
  invalidArgument,
  notFound,
  permissionDenied,
} from '../../platform/http/errors';
import { requireReadyFile } from '../../platform/storage/files.service';
import { canDeleteProduct, canWriteProduct, validOrThrow } from './access';
import { lockCategories, toCategory } from './categories.repository';
import { deriveProductColumns } from './product-derivation';
import {
  adjustStock,
  deleteProduct,
  findProduct,
  insertProduct,
  lockProduct,
  saveProduct,
  toProduct,
  type ProductDoc,
  type ProductRow,
} from './products.repository';
import { lockStore } from './stores.repository';

const STAFF_FIELDS = ['featured', 'badge', 'familyKey'] as const;

/** The store part of `{storeId}--{skuSlug}`; invalid-argument when the id has no `--`. */
export function storeIdOf(productId: string): string {
  const at = productId.indexOf('--');
  if (at <= 0)
    invalidArgument('A product id is {storeId}--{sku}.', { fields: { productId: 'not a product id' } });
  return productId.slice(0, at);
}

function docFrom(value: ProductInput, updatedBy: string): ProductDoc {
  const { stockOnHand: _stock, ...doc } = value;
  return { ...doc, updatedBy };
}

/** The editable fields of a stored product, as validateProduct reads them. */
function editableOf(row: ProductRow): ProductInput {
  const { updatedBy: _by, ...doc } = row.doc;
  return { ...doc, stockOnHand: row.stock_on_hand };
}

async function lockStoreAndCategory(
  tx: Tx,
  storeId: string,
  categoryId: CategoryId,
): Promise<{
  store: { name: string; status: Product['storeStatus'] };
  category: { name: string; synonyms: string[] };
}> {
  const store = await lockStore(tx, storeId, 'share');
  if (!store) notFound('That store does not exist.');
  const category = (await lockCategories(tx, [categoryId], 'share')).get(categoryId);
  if (!category) invalidArgument('Choose a category.', { fields: { categoryId: 'unknown category' } });
  return { store: store.doc, category: toCategory(category) };
}

export async function createProduct(
  deps: Deps,
  actor: Actor,
  productId: string,
  input: RestProductInput,
  origin: string,
): Promise<Product> {
  const storeId = storeIdOf(productId);
  if (!canWriteProduct(actor, storeId)) permissionDenied();
  if (
    !actor.isStaff &&
    (input.featured === true || (input.badge ?? null) !== null || (input.familyKey ?? null) !== null)
  ) {
    permissionDenied('Only InstaSupply staff can feature a product, give it a badge or a family.');
  }
  const value = validOrThrow(validateProduct(input, storeId));
  if (productIdFor(storeId, value.sku) !== productId) {
    invalidArgument('The product id must be {storeId}--{sku in lower case}.', {
      fields: { productId: `expected ${productIdFor(storeId, value.sku)}` },
    });
  }
  if (value.imagePath) {
    await requireReadyFile(deps.pool, value.imagePath, { purpose: 'product_photo', scopeId: storeId });
  }
  const row = await withTransaction(deps, async (tx) => {
    const { store, category } = await lockStoreAndCategory(tx, storeId, value.categoryId);
    return insertProduct(tx, {
      id: productId,
      storeId,
      doc: docFrom(value, actor.uid),
      stockOnHand: value.stockOnHand,
      columns: deriveProductColumns(value, store, category),
    });
  });
  if (!row) fail('already-exists', 'This store already has a product with that SKU.');
  return toProduct(row, origin);
}

export async function updateProduct(
  deps: Deps,
  actor: Actor,
  productId: string,
  patch: ProductPatch,
  origin: string,
): Promise<Product> {
  const before = await findProduct(deps.pool, productId);
  if (!before) notFound('That product does not exist.');
  const storeId = before.store_id;
  if (!canWriteProduct(actor, storeId)) permissionDenied();
  if (patch.imagePath && patch.imagePath !== before.doc.imagePath) {
    // The folder is checked by validateProduct below; the upload itself here, before the transaction.
    validOrThrow(validateProduct({ ...editableOf(before), ...patch }, storeId));
    await requireReadyFile(deps.pool, patch.imagePath, { purpose: 'product_photo', scopeId: storeId });
  }
  const categoryId = patch.categoryId ?? before.doc.categoryId;
  const row = await withTransaction(deps, async (tx) => {
    const { store, category } = await lockStoreAndCategory(tx, storeId, categoryId);
    const current = await lockProduct(tx, productId);
    if (!current) notFound('That product does not exist.');
    // Keys first, locks second (§3.6 rule 3): the category was read without a lock.
    if (patch.categoryId === undefined && current.doc.categoryId !== categoryId) throw new RetryTransaction();
    if (!actor.isStaff) {
      for (const key of STAFF_FIELDS) {
        if (patch[key] !== undefined && patch[key] !== current.doc[key]) {
          permissionDenied('Only InstaSupply staff can feature a product, give it a badge or a family.');
        }
      }
    }
    const value = validOrThrow(
      validateProduct({ ...editableOf(current), ...patch, sku: current.doc.sku }, storeId),
    );
    return saveProduct(tx, {
      id: productId,
      doc: docFrom(value, actor.uid),
      stockOnHand: value.stockOnHand,
      columns: deriveProductColumns(value, store, category),
    });
  });
  return toProduct(row, origin);
}

/** POST /products/{id}/stock-adjust: one relative statement, clamped; not retry-safe (§4.5). */
export async function adjustProductStock(
  deps: Deps,
  actor: Actor,
  productId: string,
  delta: number,
  origin: string,
): Promise<Product> {
  const before = await findProduct(deps.pool, productId);
  if (!before) notFound('That product does not exist.');
  if (!canWriteProduct(actor, before.store_id)) permissionDenied();
  const row = await withTransaction(deps, (tx) => adjustStock(tx, productId, delta));
  if (!row) notFound('That product does not exist.');
  return toProduct(row, origin);
}

export async function removeProduct(deps: Deps, actor: Actor, productId: string): Promise<void> {
  const before = await findProduct(deps.pool, productId);
  if (!before) notFound('That product does not exist.');
  if (!canDeleteProduct(actor, before.store_id)) permissionDenied();
  await withTransaction(deps, async (tx) => {
    const current = await lockProduct(tx, productId);
    if (!current) return;
    if (current.reserved > 0) {
      failedPrecondition('Open orders still hold units of this product. Delete it once they are done.', {
        reserved: current.reserved,
      });
    }
    await deleteProduct(tx, current);
  });
}
