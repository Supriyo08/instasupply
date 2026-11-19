/**
 * Load the starter grocery catalogue (scripts/data/catalog.ts) into a real Firebase project, or
 * into the emulators for a `demo-*` project. Safe to re-run:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run import-catalog -- --project instasupply-staging [--overwrite] [--dry-run]
 *
 * - Categories are created or refreshed (name, icon, colours, order).
 * - Missing products are created (active, rating 0). Existing products only get their descriptive
 *   fields refreshed (name, unit, description, illustration, badge, search terms); the store's
 *   live price, MRP, stock, visibility and ratings are kept unless --overwrite is passed.
 * - Seed reviews are never imported.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';

import { buildSearchTerms, COLLECTIONS } from '@instasupply/shared';

import { CATEGORIES, PRODUCTS } from './data/catalog';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

/** Firestore allows 500 writes per batch; stay well below it. */
const BATCH_LIMIT = 400;

async function main() {
  const projectId = option('project') ?? process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error('Usage: npm run import-catalog -- --project <project-id> [--overwrite] [--dry-run]');
  }
  const overwrite = flag('overwrite');
  const dryRun = flag('dry-run');
  if (projectId.startsWith('demo-')) process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

  const db = getFirestore(initializeApp({ projectId }));
  const batches: WriteBatch[] = [db.batch()];
  let writes = 0;
  const queue = (apply: (batch: WriteBatch) => void) => {
    if (writes > 0 && writes % BATCH_LIMIT === 0) batches.push(db.batch());
    apply(batches[batches.length - 1]!);
    writes += 1;
  };

  for (const { id, ...category } of CATEGORIES) {
    queue((batch) => batch.set(db.collection(COLLECTIONS.categories).doc(id), category, { merge: true }));
  }

  const refs = PRODUCTS.map((product) => db.collection(COLLECTIONS.products).doc(product.id));
  const existing = await db.getAll(...refs);
  let created = 0;
  let refreshed = 0;
  PRODUCTS.forEach(({ id: _id, ...product }, index) => {
    const category = CATEGORIES.find((item) => item.id === product.categoryId);
    if (!category) throw new Error(`Product ${_id} has an unknown category ${product.categoryId}.`);
    const searchTerms = buildSearchTerms(product.name, [category.name, product.unit]);
    const ref = refs[index]!;
    if (!existing[index]!.exists) {
      created += 1;
      queue((batch) =>
        batch.set(ref, {
          ...product,
          imageUrl: null,
          rating: 0,
          ratingCount: 0,
          active: true,
          searchTerms,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
      return;
    }
    refreshed += 1;
    const descriptive = {
      name: product.name,
      categoryId: product.categoryId,
      unit: product.unit,
      description: product.description,
      imageKey: product.imageKey,
      badge: product.badge,
      searchTerms,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const commercial = overwrite
      ? {
          price: product.price,
          mrp: product.mrp,
          stock: product.stock,
          featured: product.featured,
          active: true,
        }
      : {};
    queue((batch) => batch.set(ref, { ...descriptive, ...commercial }, { merge: true }));
  });

  const summary = `${CATEGORIES.length} categories, ${created} new and ${refreshed} existing products`;
  if (dryRun) {
    console.log(`Dry run for ${projectId}: would write ${summary} (${writes} writes).`);
    return;
  }
  for (const batch of batches) await batch.commit();
  console.log(
    `✓ Imported ${summary} into ${projectId}${overwrite ? ' (prices and stock overwritten)' : ''}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
