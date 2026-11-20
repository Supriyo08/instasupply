/**
 * The 25 categories of MARKETPLACE §1.5 for `seed --demo` and the test fixtures. The table itself lives in
 * `@instasupply/shared` (`CATEGORIES`, tile order); `migrate` inserts the missing ones as reference data
 * (docs/PLATFORM.md §2.6), and the seed makes sure every one exists before it writes products.
 */
import { CATEGORIES, CATEGORY_IDS, type Category, type CategoryId } from '@instasupply/shared';

/** Every category, in tile order (sortOrder 1 to 25). */
export const SEED_CATEGORIES: readonly Category[] = CATEGORY_IDS.map((id) => CATEGORIES[id]);

export const SEED_CATEGORY_IDS: readonly CategoryId[] = CATEGORY_IDS;
