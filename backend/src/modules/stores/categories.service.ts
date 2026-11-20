/**
 * Category writes (docs/PLATFORM.md §5.3.4): staff edit the 25 categories, admins delete an unused one. A change
 * of name or synonyms recomputes `search_terms` of every product of the category in the same transaction.
 *
 * Locks: categories (rank 9) → products of the category, in id order (rank 10).
 */
import type { Category, CategoryId, CategoryInput } from '@instasupply/shared';
import type { Deps } from '../../container';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import {
  categoryInUse,
  deleteCategory,
  lockAllCategories,
  lockCategories,
  toCategory,
  upsertCategory,
} from './categories.repository';
import { searchTermsFor } from './product-derivation';
import { lockProductsOfCategory, saveSearchTerms } from './products.repository';

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** The products whose terms change with the category's name or synonyms. Returns how many were rewritten. */
async function recomputeSearchTerms(tx: Tx, category: Category): Promise<number> {
  let changed = 0;
  for (const row of await lockProductsOfCategory(tx, category.id)) {
    const terms = searchTermsFor(row.doc, category);
    if (sameList(terms, row.search_terms)) continue;
    await saveSearchTerms(tx, row, terms);
    changed += 1;
  }
  return changed;
}

async function write(
  tx: Tx,
  id: CategoryId,
  next: (current: Category | null) => Category,
): Promise<Category> {
  const row = (await lockCategories(tx, [id])).get(id) ?? null;
  const current = row ? toCategory(row) : null;
  const category = next(current);
  await upsertCategory(tx, category, current !== null);
  if (current && (current.name !== category.name || !sameList(current.synonyms, category.synonyms))) {
    await recomputeSearchTerms(tx, category);
  }
  return category;
}

export function putCategory(deps: Deps, id: CategoryId, input: CategoryInput): Promise<Category> {
  return withTransaction(deps, (tx) => write(tx, id, () => ({ ...input, id })));
}

export function patchCategory(deps: Deps, id: CategoryId, patch: Partial<CategoryInput>): Promise<Category> {
  return withTransaction(deps, (tx) =>
    write(tx, id, (current) => {
      if (!current) notFound('That category does not exist.');
      return { ...current, ...patch, id };
    }),
  );
}

/** Rewrites sortOrder 1…n; `ids` must name every category once. */
export async function reorderCategories(deps: Deps, ids: CategoryId[]): Promise<void> {
  if (new Set(ids).size !== ids.length)
    invalidArgument('Each category may appear once.', { fields: { ids: 'duplicate' } });
  await withTransaction(deps, async (tx) => {
    const rows = await lockAllCategories(tx);
    const known = new Set(rows.map((row) => row.id));
    if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
      invalidArgument('List every category once, in the new order.', {
        fields: { ids: 'not every category' },
      });
    }
    const byId = new Map(rows.map((row) => [row.id, toCategory(row)]));
    for (const [index, id] of ids.entries()) {
      const current = byId.get(id)!;
      if (current.sortOrder === index + 1) continue;
      await upsertCategory(tx, { ...current, sortOrder: index + 1 }, true);
    }
  });
}

export async function removeCategory(deps: Deps, id: CategoryId): Promise<void> {
  await withTransaction(deps, async (tx) => {
    const row = (await lockCategories(tx, [id])).get(id);
    if (!row) notFound('That category does not exist.');
    if (await categoryInUse(tx, id)) {
      failedPrecondition('Products still use this category. Move them to another category first.');
    }
    await deleteCategory(tx, id);
  });
}
