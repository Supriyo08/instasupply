import type {
  AppNotification,
  Issue,
  Jobsite,
  Order,
  Product,
  Quote,
  SavedCard,
  StoreOrder,
  StoreReview,
  SupportMessage,
  SupportThread,
} from '@instasupply/shared';

import type { Favorite, FileUrlResponse, StoreOrderProof, WithId } from '../contract';
import { catalogPaths } from '../resources/catalog';
import { filePaths } from '../resources/files';
import { issuePaths } from '../resources/issues';
import { mePaths } from '../resources/me';
import { notificationPaths } from '../resources/notifications';
import { orderPaths } from '../resources/orders';
import { quotePaths } from '../resources/quotes';
import { supportPaths } from '../resources/support';
import { topics } from '../topics';
import type { QueryDescriptor } from '../query/types';

import { appendMessage, docQuery, idOrNull, listQuery, pagedQuery, prependCreated } from './helpers';

/** `'active'` and `'past'` of the Orders tab (CLIENTS §4.1). */
export const ORDER_STATES = {
  active: ['placed', 'confirmed', 'preparing', 'ready', 'on_the_way'],
  past: ['completed', 'cancelled'],
} as const;

export type OrderState = keyof typeof ORDER_STATES;

export const customerQueries = {
  jobsites: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<Jobsite>(['jobsites', id], id !== null, mePaths.jobsites, {});
  },

  cards: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<SavedCard>(['cards', id], id !== null, mePaths.cards, {});
  },

  favorites: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<WithId<Favorite>>(['favorites', id], id !== null, mePaths.favorites, {});
  },

  buyAgain: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<Product>(['buy-again', id], id !== null, mePaths.buyAgain, {}, { follow: false, limit: 12 });
  },

  notifications: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<AppNotification>(['notifications', id], id !== null, notificationPaths.notifications, {}, {
      limit: 50,
      follow: false,
      topics: id ? [topics.userNotifications(id)] : [],
      pollS: 30,
      reduce: prependCreated,
    });
  },

  customerOrders: (uid: string | null | undefined, state: OrderState, filters: { jobsiteId?: string | null } = {}) => {
    const id = idOrNull(uid);
    return pagedQuery<Order>(
      ['orders', 'customer', id, state, filters.jobsiteId ?? null],
      id !== null,
      orderPaths.orders,
      { customerId: id, status: ORDER_STATES[state], jobsiteId: filters.jobsiteId, sort: 'createdAt:desc' },
      { topics: id ? [topics.userOrders(id)] : [], pollS: 20 },
    );
  },

  order: (orderId: string | null | undefined) => {
    const id = idOrNull(orderId);
    return docQuery<Order>(['order', id], id !== null, () => orderPaths.order(id ?? ''), {
      topics: id ? [topics.order(id)] : [],
      pollS: 15,
    });
  },

  orderStoreOrders: (orderId: string | null | undefined) => {
    const id = idOrNull(orderId);
    return listQuery<StoreOrder>(['store-orders', 'order', id], id !== null, orderPaths.storeOrders, { orderId: id }, {
      topics: id ? [topics.order(id)] : [],
      pollS: 15,
    });
  },

  storeOrder: (storeOrderId: string | null | undefined) => {
    const id = idOrNull(storeOrderId);
    return docQuery<StoreOrder>(['store-order', id], id !== null, () => orderPaths.storeOrder(id ?? ''), {
      topics: id ? [topics.storeOrder(id)] : [],
      pollS: 10,
    });
  },

  /** The drop-off photo URL lives 300 s: refetched a minute before `expiresAt` while observed. */
  storeOrderProof: (storeOrderId: string | null | undefined) => {
    const id = idOrNull(storeOrderId);
    return docQuery<StoreOrderProof>(
      ['store-order-proof', id],
      id !== null,
      () => orderPaths.storeOrderProof(id ?? ''),
      { expiresAt: (proof) => proof?.expiresAt ?? null },
    );
  },

  customerQuotes: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return pagedQuery<Quote>(
      ['quotes', 'customer', id],
      id !== null,
      quotePaths.quotes,
      { customerId: id, sort: 'createdAt:desc' },
      { topics: id ? [topics.userQuotes(id)] : [], pollS: 30 },
    );
  },

  quote: (quoteId: string | null | undefined) => {
    const id = idOrNull(quoteId);
    return docQuery<Quote>(['quote', id], id !== null, () => quotePaths.quote(id ?? ''), {
      topics: id ? [topics.quote(id)] : [],
      pollS: 15,
    });
  },

  customerIssues: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return pagedQuery<Issue>(
      ['issues', 'customer', id],
      id !== null,
      issuePaths.issues,
      { customerId: id, sort: 'createdAt:desc' },
      { topics: id ? [topics.userIssues(id)] : [], pollS: 30 },
    );
  },

  issue: (issueId: string | null | undefined) => {
    const id = idOrNull(issueId);
    return docQuery<Issue>(['issue', id], id !== null, () => issuePaths.issue(id ?? ''), {
      topics: id ? [topics.issue(id)] : [],
      pollS: 15,
    });
  },

  myReview: (storeId: string | null | undefined, storeOrderId: string | null | undefined) => {
    const s = idOrNull(storeId);
    const o = idOrNull(storeOrderId);
    return docQuery<WithId<StoreReview>>(['store-review', s, o], s !== null && o !== null, () =>
      catalogPaths.storeReview(s ?? '', o ?? ''),
    );
  },

  supportThread: (threadId: string | null | undefined) => {
    const id = idOrNull(threadId);
    return docQuery<WithId<SupportThread>>(['support-thread', id], id !== null, () => supportPaths.thread(id ?? ''), {
      topics: id ? [topics.supportThread(id)] : [],
      pollS: 15,
    });
  },

  supportMessages: (threadId: string | null | undefined) => {
    const id = idOrNull(threadId);
    return listQuery<SupportMessage>(['support-messages', id], id !== null, supportPaths.messages(id ?? ''), {}, {
      limit: 100,
      follow: false,
      topics: id ? [topics.supportThread(id)] : [],
      pollS: 10,
      reduce: appendMessage,
    });
  },

  /** Used through `useFileUrl(path)`: the URL is refetched a minute before it expires. */
  fileUrl: (path: string | null | undefined): QueryDescriptor<FileUrlResponse | null> => {
    const p = idOrNull(path);
    return {
      ...docQuery<FileUrlResponse>(['file-url', p], p !== null, () => filePaths.url, {
        query: { path: p },
        notFoundAsNull: false,
        expiresAt: (file) => file?.expiresAt ?? null,
      }),
      // A signed URL is useless once expired; never serve one from an old cache entry.
      gcMs: 60_000,
    };
  },
};
