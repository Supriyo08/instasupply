/**
 * The single place for live topic strings (CLIENTS §4.1, PLATFORM §8.2). Screens and descriptors call
 * these builders and never write a topic themselves, so a renamed topic changes only this file.
 */

export type OpsArea =
  | 'orders'
  | 'store-orders'
  | 'deliveries'
  | 'job-offers'
  | 'quotes'
  | 'issues'
  | 'support-threads'
  | 'threads'
  | 'drivers'
  | 'payouts'
  | 'suggestions'
  | 'outbox';

export const topics = {
  // public
  categories: () => 'categories',
  stores: () => 'stores',
  store: (storeId: string) => `store:${storeId}`,
  storeProducts: (storeId: string) => `store:${storeId}:products`,
  product: (productId: string) => `product:${productId}`,
  /** Payload: the whole `PublicTracking`. */
  tracking: (token: string) => `tracking:${token}`,
  // the caller's own
  user: (uid: string) => `user:${uid}`,
  /** Payload on `created`: the `AppNotification`. */
  userNotifications: (uid: string) => `user:${uid}:notifications`,
  userOrders: (uid: string) => `user:${uid}:orders`,
  userQuotes: (uid: string) => `user:${uid}:quotes`,
  userIssues: (uid: string) => `user:${uid}:issues`,
  // documents
  order: (orderId: string) => `order:${orderId}`,
  storeOrder: (id: string) => `store-order:${id}`,
  quote: (id: string) => `quote:${id}`,
  issue: (id: string) => `issue:${id}`,
  /** Payload on `message`: the `SupportMessage`. */
  supportThread: (threadId: string) => `support-thread:${threadId}`,
  // stores
  storeOrders: (storeId: string) => `store:${storeId}:orders`,
  storeIssues: (storeId: string) => `store:${storeId}:issues`,
  storePayouts: (storeId: string) => `store:${storeId}:payouts`,
  // drivers
  driverDeliveries: (uid: string) => `driver:${uid}:deliveries`,
  driverRoute: (uid: string) => `driver:${uid}:route`,
  driverEarnings: (uid: string) => `driver:${uid}:earnings`,
  delivery: (id: string) => `delivery:${id}`,
  jobOffers: (cityId: string, capacityClass: string) => `job-offers:${cityId}:${capacityClass}`,
  /** Payload on `message`: the `ChatMessage`. */
  chatThread: (driverId: string) => `thread:${driverId}`,
  // staff
  /** Payload: `WithId<DriverLocation>`. */
  driverLocations: () => 'driver-locations',
  ops: (area: OpsArea) => `ops:${area}`,
} as const;

export type Topics = typeof topics;
