/**
 * The old `onStoreWritten` (docs/PLATFORM.md §9.4, MARKETPLACE §5.6): a store's name and status are copied
 * onto its products in the transaction that changes the store, with statement (h) of §3.5 (lock the
 * products in id order, then one UPDATE). `listed` follows by itself: it is generated from `store_status`.
 * Only rows whose copy differs are written, and each of them publishes its product topics.
 */
import type { Store } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { fanOutStoreColumns } from './products.repository';

/** The store row must be locked by the caller (rank 8 before the products, rank 10). Returns the count. */
export async function fanOutStore(tx: Tx, store: Pick<Store, 'id' | 'name' | 'status'>): Promise<number> {
  const rows = await fanOutStoreColumns(tx, store.id, store.name, store.status);
  return rows.length;
}
