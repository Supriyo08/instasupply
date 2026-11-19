import type {
  Issue,
  LedgerEntry,
  Payout,
  Product,
  StoreOrder,
  StorePrivateSettings,
  UserProfile,
} from '@instasupply/shared';

import type { LedgerBalance, WithId } from '../contract';
import { catalogPaths } from '../resources/catalog';
import { financePaths } from '../resources/finance';
import { issuePaths } from '../resources/issues';
import { orderPaths } from '../resources/orders';
import { userPaths } from '../resources/users';
import { topics } from '../topics';

import { docQuery, idOrNull, listQuery, pagedQuery, valueQuery } from './helpers';

export type PayeeType = 'store' | 'driver';

export interface LedgerFilters {
  unpaid?: boolean | null;
  held?: boolean | null;
  payoutId?: string | null;
}

/** The board's columns (MARKETPLACE §8): everything that still needs the store. */
const BOARD_STATUSES = ['new', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'failed'];

function payeeTopic(payeeType: PayeeType, payeeId: string): string {
  return payeeType === 'store' ? topics.storePayouts(payeeId) : topics.driverEarnings(payeeId);
}

export const supplierQueries = {
  storeBoard: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return listQuery<StoreOrder>(
      ['store-orders', 'board', id],
      id !== null,
      orderPaths.storeOrders,
      { storeId: id, status: BOARD_STATUSES, sort: 'readyBy:asc' },
      { limit: 200, topics: id ? [topics.storeOrders(id)] : [], pollS: 10 },
    );
  },

  storeCompleted: (storeId: string | null | undefined, sinceMs: number) => {
    const id = idOrNull(storeId);
    return listQuery<StoreOrder>(
      ['store-orders', 'completed', id, sinceMs],
      id !== null,
      orderPaths.storeOrders,
      { storeId: id, completedSince: sinceMs, sort: 'completedAt:desc' },
      { limit: 200, maxRows: 1_000, topics: id ? [topics.storeOrders(id)] : [], pollS: 60 },
    );
  },

  storeHistory: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return pagedQuery<StoreOrder>(
      ['store-orders', 'history', id],
      id !== null,
      orderPaths.storeOrders,
      { storeId: id, sort: 'createdAt:desc' },
      { topics: id ? [topics.storeOrders(id)] : [] },
    );
  },

  storeSettings: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return docQuery<StorePrivateSettings>(
      ['store-settings', id],
      id !== null,
      () => catalogPaths.storeSettings(id ?? ''),
      {
        topics: id ? [topics.store(id)] : [],
      },
    );
  },

  /** No `listed` filter: the portal shows inactive rows too. */
  portalCatalog: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return listQuery<Product>(
      ['products', 'portal', id],
      id !== null,
      catalogPaths.products,
      { storeId: id, sort: 'name:asc' },
      { topics: id ? [topics.storeProducts(id)] : [], pollS: 30 },
    );
  },

  storeIssues: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return pagedQuery<Issue>(
      ['issues', 'store', id],
      id !== null,
      issuePaths.issues,
      { storeId: id, sort: 'createdAt:desc' },
      { topics: id ? [topics.storeIssues(id)] : [], pollS: 60 },
    );
  },

  ledger: (payeeType: PayeeType, payeeId: string | null | undefined, filters: LedgerFilters = {}) => {
    const id = idOrNull(payeeId);
    return pagedQuery<WithId<LedgerEntry>>(
      ['ledger', payeeType, id, filters.unpaid ?? null, filters.held ?? null, filters.payoutId ?? null],
      id !== null,
      financePaths.ledgerEntries,
      {
        payeeType,
        payeeId: id,
        unpaid: filters.unpaid ?? undefined,
        held: filters.held ?? undefined,
        payoutId: filters.payoutId,
        sort: 'createdAt:desc',
      },
      { topics: id ? [payeeTopic(payeeType, id)] : [] },
    );
  },

  /** Balances are the server's sums, never computed from a page of entries. */
  ledgerBalance: (payeeType: PayeeType, payeeId: string | null | undefined) => {
    const id = idOrNull(payeeId);
    return valueQuery<LedgerBalance | null>(
      ['ledger-balance', payeeType, id],
      id !== null,
      null,
      () => financePaths.ledgerBalance,
      () => ({ payeeType, payeeId: id }),
      { topics: id ? [payeeTopic(payeeType, id)] : [], pollS: 60 },
    );
  },

  payouts: (payeeType: PayeeType, payeeId: string | null | undefined) => {
    const id = idOrNull(payeeId);
    return pagedQuery<WithId<Payout>>(
      ['payouts', payeeType, id],
      id !== null,
      financePaths.payouts,
      { payeeType, payeeId: id, sort: 'createdAt:desc' },
      { topics: id ? [payeeTopic(payeeType, id)] : [] },
    );
  },

  storeTeam: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return listQuery<UserProfile>(['users', 'store', id], id !== null, userPaths.users, {
      role: 'supplier',
      storeId: id,
    });
  },
};
