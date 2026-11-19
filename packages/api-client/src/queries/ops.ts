import type {
  ChatThread,
  Delivery,
  DeliveryEvent,
  DeliveryPrivateMeta,
  DriverLocation,
  Issue,
  JobOffer,
  Order,
  Payout,
  Product,
  Quote,
  StoreOrder,
  StoreOrderPrivateMeta,
  StoreSuggestion,
  SupportThread,
  UserProfile,
} from '@instasupply/shared';

import type {
  IssueNotes,
  JobState,
  OpsDashboard,
  OpsStoreRow,
  OutboxMessage,
  SessionInfo,
  WithId,
} from '../contract';
import type { QueryValue } from '../http';
import { canonicalJson } from '../ids';
import { catalogPaths } from '../resources/catalog';
import { chatPaths } from '../resources/chat';
import { deliveryPaths } from '../resources/deliveries';
import { financePaths } from '../resources/finance';
import { issuePaths } from '../resources/issues';
import { jobPaths } from '../resources/jobs';
import { opsPaths } from '../resources/ops';
import { orderPaths } from '../resources/orders';
import { quotePaths } from '../resources/quotes';
import { supportPaths } from '../resources/support';
import { userPaths } from '../resources/users';
import { topics } from '../topics';

import { docQuery, idOrNull, listQuery, pagedQuery, upsertById, valueQuery } from './helpers';

/** Filters are passed through as query parameters; the key is their canonical JSON. */
export type Filters = Record<string, QueryValue>;

const OPEN_DELIVERIES = ['unassigned', 'assigned', 'accepted', 'picked_up', 'in_transit', 'arrived'];
const CLOSED_DELIVERIES = ['delivered', 'failed', 'cancelled'];

export const opsQueries = {
  opsDashboard: () =>
    valueQuery<OpsDashboard | null>(['ops-dashboard'], true, null, () => opsPaths.dashboard, () => ({}), {
      topics: [
        topics.ops('orders'),
        topics.ops('store-orders'),
        topics.ops('deliveries'),
        topics.ops('job-offers'),
        topics.ops('quotes'),
        topics.ops('issues'),
        topics.ops('support-threads'),
      ],
      minRefetchMs: 5_000,
      pollS: 30,
    }),

  opsOrders: (filters: Filters = {}) =>
    pagedQuery<Order>(['orders', 'ops', canonicalJson(filters)], true, orderPaths.orders, {
      ...filters,
      sort: 'createdAt:desc',
    }, { topics: [topics.ops('orders')], pollS: 30 }),

  opsStoreOrders: (filters: Filters = {}) =>
    pagedQuery<StoreOrder>(['store-orders', 'ops', canonicalJson(filters)], true, orderPaths.storeOrders, {
      ...filters,
      sort: 'createdAt:desc',
    }, { topics: [topics.ops('store-orders')], pollS: 30 }),

  storeOrderPrivate: (storeOrderId: string | null | undefined) => {
    const id = idOrNull(storeOrderId);
    return docQuery<StoreOrderPrivateMeta>(['store-order-private', id], id !== null, () =>
      orderPaths.storeOrderPrivate(id ?? ''), { topics: id ? [topics.storeOrder(id)] : [] });
  },

  openDeliveries: () =>
    listQuery<Delivery>(['deliveries', 'open'], true, deliveryPaths.deliveries, {
      status: OPEN_DELIVERIES,
      sort: 'createdAt:desc',
    }, { topics: [topics.ops('deliveries')], pollS: 15 }),

  deliveriesClosedSince: (sinceMs: number) =>
    listQuery<Delivery>(['deliveries', 'closed-since', sinceMs], true, deliveryPaths.deliveries, {
      status: CLOSED_DELIVERIES,
      updatedSince: sinceMs,
      sort: 'updatedAt:desc',
    }, { topics: [topics.ops('deliveries')], pollS: 60 }),

  deliveriesCreatedSince: (sinceMs: number) =>
    listQuery<Delivery>(['deliveries', 'created-since', sinceMs], true, deliveryPaths.deliveries, {
      createdSince: sinceMs,
      sort: 'createdAt:desc',
    }, { topics: [topics.ops('deliveries')], pollS: 60 }),

  driverDeliveries: (driverId: string | null | undefined) => {
    const id = idOrNull(driverId);
    return listQuery<Delivery>(['deliveries', 'driver', id, 'recent'], id !== null, deliveryPaths.deliveries, {
      driverId: id,
      sort: 'createdAt:desc',
    }, { limit: 50, follow: false, topics: id ? [topics.driverDeliveries(id)] : [], pollS: 30 });
  },

  labourerQueue: () =>
    listQuery<Delivery>(['deliveries', 'labourer'], true, deliveryPaths.deliveries, { unloadStatus: 'needed' }, {
      limit: 200,
      topics: [topics.ops('deliveries')],
      pollS: 30,
    }),

  deliveryPrivate: (deliveryId: string | null | undefined) => {
    const id = idOrNull(deliveryId);
    return docQuery<DeliveryPrivateMeta>(['delivery-private', id], id !== null, () => deliveryPaths.private(id ?? ''));
  },

  opsJobOffers: () =>
    listQuery<WithId<JobOffer>>(['job-offers', 'ops'], true, jobPaths.offers, {
      status: ['scheduled', 'open'],
      sort: 'opensAt:asc',
    }, { topics: [topics.ops('job-offers')], pollS: 20 }),

  drivers: () =>
    listQuery<UserProfile>(['users', 'drivers'], true, userPaths.users, { role: 'driver' }, {
      topics: [topics.ops('drivers')],
      pollS: 60,
    }),

  staff: () => listQuery<UserProfile>(['users', 'staff'], true, userPaths.users, { role: ['admin', 'dispatcher'] }),

  userSessions: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return listQuery<SessionInfo>(['user-sessions', id], id !== null, userPaths.sessions(id ?? ''), {});
  },

  opsJobs: () =>
    listQuery<JobState>(['ops-jobs'], true, opsPaths.jobs, {}, {
      limit: 50,
      follow: false,
      topics: [topics.ops('payouts')],
      pollS: 60,
    }),

  user: (uid: string | null | undefined) => {
    const id = idOrNull(uid);
    return docQuery<UserProfile>(['user', id], id !== null, () => userPaths.user(id ?? ''), {
      topics: [topics.ops('drivers')],
      pollS: 60,
    });
  },

  driverLocations: () =>
    listQuery<WithId<DriverLocation>>(['driver-locations'], true, deliveryPaths.driverLocations, {}, {
      topics: [topics.driverLocations()],
      pollS: 10,
      reduce: upsertById,
    }),

  chatThreads: () =>
    listQuery<WithId<ChatThread>>(['chat-threads'], true, chatPaths.threads, { sort: 'updatedAt:desc' }, {
      limit: 200,
      topics: [topics.ops('threads')],
      pollS: 20,
    }),

  supportThreads: (filters: { kind?: string | null; status?: string | null } = {}) =>
    listQuery<WithId<SupportThread>>(
      ['support-threads', filters.kind ?? null, filters.status ?? null],
      true,
      supportPaths.threads,
      { kind: filters.kind, status: filters.status, sort: 'updatedAt:desc' },
      { limit: 200, topics: [topics.ops('support-threads')], pollS: 20 },
    ),

  opsQuotes: (filters: Filters = {}) =>
    pagedQuery<Quote>(['quotes', 'ops', canonicalJson(filters)], true, quotePaths.quotes, {
      ...filters,
      sort: 'respondBy:asc',
    }, { topics: [topics.ops('quotes')], pollS: 30 }),

  /** The builder draft: opaque JSON owned by the quote builder. */
  quoteWorkspace: (quoteId: string | null | undefined) => {
    const id = idOrNull(quoteId);
    return docQuery<Record<string, unknown>>(['quote-workspace', id], id !== null, () => quotePaths.workspace(id ?? ''));
  },

  opsIssues: (filters: Filters = {}) =>
    pagedQuery<Issue>(['issues', 'ops', canonicalJson(filters)], true, issuePaths.issues, {
      ...filters,
      sort: 'createdAt:desc',
    }, { topics: [topics.ops('issues')], pollS: 30 }),

  issueNotes: (issueId: string | null | undefined) => {
    const id = idOrNull(issueId);
    return docQuery<IssueNotes>(['issue-notes', id], id !== null, () => issuePaths.notes(id ?? ''));
  },

  opsStores: () =>
    listQuery<OpsStoreRow>(['ops-stores'], true, opsPaths.stores, {}, {
      topics: [topics.stores(), topics.ops('store-orders')],
      minRefetchMs: 5_000,
      pollS: 60,
    }),

  /** No `listed` filter: staff see inactive and unlisted rows. */
  opsCatalog: (filters: Filters = {}) =>
    pagedQuery<Product>(['products', 'ops', canonicalJson(filters)], true, catalogPaths.products, {
      ...filters,
      sort: 'name:asc',
    }),

  opsPayouts: (filters: Filters = {}) =>
    pagedQuery<WithId<Payout>>(['payouts', 'ops', canonicalJson(filters)], true, financePaths.payouts, {
      ...filters,
      sort: 'createdAt:desc',
    }, { topics: [topics.ops('payouts')] }),

  suggestions: (status: StoreSuggestion['status'] | null | undefined) =>
    listQuery<WithId<StoreSuggestion>>(['suggestions', status ?? null], true, opsPaths.suggestions, {
      status,
      sort: 'createdAt:desc',
    }, { limit: 200, topics: [topics.ops('suggestions')], pollS: 120 }),

  outbox: () =>
    pagedQuery<OutboxMessage>(['outbox'], true, opsPaths.devOutbox, {}, {
      limit: 100,
      topics: [topics.ops('outbox')],
      pollS: 15,
    }),

  activity: (limit: number) =>
    listQuery<DeliveryEvent>(['activity', limit], true, deliveryPaths.activity, {}, {
      limit,
      follow: false,
      topics: [topics.ops('deliveries')],
      pollS: 30,
    }),
};
