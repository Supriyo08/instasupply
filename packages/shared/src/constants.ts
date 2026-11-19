/**
 * Names and reference lists shared by every app and every function: collections, callables, storage
 * folders, notification channels and preferences, and the reason lists of the delivery machine
 * (§1.2, §2.3, §5.3, §5.8). Nobody types one of these strings by hand anywhere else.
 */
import type {
  DeclineReasonId,
  FailureReasonId,
  NotificationType,
  Priority,
  Role,
  UserPreferences,
} from './types';

export const APP_NAME = 'InstaSupply';

/**
 * Firestore collection names (§1.2): the single source of truth for every client and function.
 * Subcollection names are listed next to their parent.
 */
export const COLLECTIONS = {
  users: 'users',
  /** `users/{uid}/jobsites`: saved jobsites. */
  jobsites: 'jobsites',
  /** `users/{uid}/cards`. */
  cards: 'cards',
  /** `users/{uid}/favorites`: saved materials. */
  favorites: 'favorites',
  /** `users/{uid}/devices`: push tokens. */
  devices: 'devices',
  /** `carts/{uid}`: the signed-in cart (P1, D18). */
  carts: 'carts',
  categories: 'categories',
  stores: 'stores',
  /** `stores/{storeId}/reviews/{storeOrderId}`: one rating per completed store order (D12). */
  reviews: 'reviews',
  products: 'products',
  orders: 'orders',
  storeOrders: 'storeOrders',
  deliveries: 'deliveries',
  /** `deliveries/{id}/events`: the audit trail. */
  events: 'events',
  /** `{stores|storeOrders|deliveries|quotes|issues}/{id}/private`: see the `PRIVATE_*_DOC` names. */
  private: 'private',
  jobOffers: 'jobOffers',
  tracking: 'tracking',
  routes: 'routes',
  driverLocations: 'driverLocations',
  /** Dispatch ↔ driver chat, `threads/{driverId}`. */
  threads: 'threads',
  /** `threads/{id}/messages` and `supportThreads/{id}/messages`. */
  messages: 'messages',
  /** Customer or store ↔ InstaSupply chat (D11). */
  supportThreads: 'supportThreads',
  quotes: 'quotes',
  issues: 'issues',
  ledgerEntries: 'ledgerEntries',
  payouts: 'payouts',
  storeSuggestions: 'storeSuggestions',
  notifications: 'notifications',
  counters: 'counters',
  otpChallenges: 'otpChallenges',
  rateLimits: 'rateLimits',
  devOutbox: 'devOutbox',
} as const;

/** `deliveries/{id}/private/meta` (tracking token, hand-off code) and `storeOrders/{id}/private/meta` (pickup PIN). */
export const PRIVATE_META_DOC = 'meta';
/** `stores/{storeId}/private/settings`: commission, payout account, alert phone, loading notes. */
export const PRIVATE_SETTINGS_DOC = 'settings';
/** `quotes/{quoteId}/private/workspace`: the quote-builder draft. */
export const PRIVATE_WORKSPACE_DOC = 'workspace';
/** `issues/{issueId}/private/notes`: internal notes. */
export const PRIVATE_NOTES_DOC = 'notes';

/** Documents of `counters` that hand out human numbers (§1.1). Orders and manual deliveries share one. */
export const COUNTERS = { deliveries: 'deliveries', quotes: 'quotes', issues: 'issues' } as const;

/** Top-level Storage folders (§6.4). Uploads go to `{folder}/{ownerId}/…`; the server checks the same prefix. */
export const STORAGE_FOLDERS = {
  /** `proofs/{deliveryId}/…`: drop-off photos. */
  proofs: 'proofs',
  /** `quoteUploads/{uid}/{requestId}/…`: material-list attachments. */
  quoteUploads: 'quoteUploads',
  /** `issuePhotos/{issueId}/…`. */
  issuePhotos: 'issuePhotos',
  /** `storePhotos/{storeId}/…`. */
  storePhotos: 'storePhotos',
  /** `productPhotos/{storeId}/…`. */
  productPhotos: 'productPhotos',
  /** `avatars/{uid}/…`. */
  avatars: 'avatars',
} as const;

/** Callable Cloud Function names (§5.3, §5.4). `api.ts` gives each one its request and response type. */
export const CALLABLES = {
  // accounts
  registerCustomer: 'registerCustomer',
  registerDriver: 'registerDriver',
  requestPhoneOtp: 'requestPhoneOtp',
  verifyPhoneOtp: 'verifyPhoneOtp',
  createStaffUser: 'createStaffUser',
  setDriverStatus: 'setDriverStatus',
  updateDriverVehicle: 'updateDriverVehicle',
  reviewDriverVehicle: 'reviewDriverVehicle',
  inviteSupplierUser: 'inviteSupplierUser',
  setSupplierUserStatus: 'setSupplierUserStatus',
  // checkout
  placeOrder: 'placeOrder',
  cancelOrder: 'cancelOrder',
  // stores
  acceptStoreOrder: 'acceptStoreOrder',
  updateStoreOrderStatus: 'updateStoreOrderStatus',
  rejectStoreOrder: 'rejectStoreOrder',
  completePickup: 'completePickup',
  updateStoreProfile: 'updateStoreProfile',
  createStore: 'createStore',
  updateStoreSettings: 'updateStoreSettings',
  // deliveries and jobs
  createDeliveries: 'createDeliveries',
  assignDelivery: 'assignDelivery',
  updateDeliveryStatus: 'updateDeliveryStatus',
  completeDelivery: 'completeDelivery',
  claimJob: 'claimJob',
  checkInAtStore: 'checkInAtStore',
  resolveFailedDelivery: 'resolveFailedDelivery',
  /** P1 (§14.6). */
  boostJobPayout: 'boostJobPayout',
  optimizeRoute: 'optimizeRoute',
  geocodeAddress: 'geocodeAddress',
  // quotes and issues
  submitMaterialList: 'submitMaterialList',
  sendQuote: 'sendQuote',
  acceptQuote: 'acceptQuote',
  closeQuote: 'closeQuote',
  reopenQuote: 'reopenQuote',
  reportIssue: 'reportIssue',
  resolveIssue: 'resolveIssue',
  // misc
  suggestStore: 'suggestStore',
  sendTestNotification: 'sendTestNotification',
  /** Admin only, and only where test jobs are allowed: runs a scheduled job with a chosen `now`. */
  runJobNow: 'runJobNow',
} as const;

export type CallableName = keyof typeof CALLABLES;

/** The emulator and every development build stay here; staging and production run in Toronto (D13). */
export const DEFAULT_FUNCTIONS_REGION = 'us-central1';

/** A driver with no location update for this long is shown as offline/stale. */
export const LOCATION_STALE_MS = 2 * 60 * 1000;

/** Default time a driver spends at each stop, used for ETAs. */
export const DEFAULT_SERVICE_SECONDS = 3 * 60;

/** Orders, store orders (`IS-10042-A`) and manual deliveries: `IS-10042` (§1.1). */
export const ORDER_ID_PREFIX = 'IS';
/** Quotes: `Q-10001`. */
export const QUOTE_NUMBER_PREFIX = 'Q';
/** Issues: `CASE-10001`. */
export const ISSUE_NUMBER_PREFIX = 'CASE';

export const MAX_DELIVERIES_PER_IMPORT = 200;

export const MAX_CHAT_MESSAGE_LENGTH = 1000;

export const PRIORITY_META: Record<Priority, { label: string; weight: number }> = {
  normal: { label: 'Normal', weight: 1 },
  high: { label: 'High', weight: 2 },
  urgent: { label: 'Urgent', weight: 4 },
};

export const PRIORITIES = Object.keys(PRIORITY_META) as Priority[];

// ---------- delivery reasons and driver chat (§2.3) ----------

/**
 * Why a delivery failed at the site. `siteCaused` decides the money: the driver is still paid the offer
 * and the customer may still owe the delivery and labourer fees (§3.7, §3.10); for the other reasons
 * neither applies.
 */
export const FAILURE_REASONS: { id: FailureReasonId; label: string; siteCaused: boolean }[] = [
  { id: 'no_one_on_site', label: 'Nobody on site', siteCaused: true },
  { id: 'site_closed', label: 'Site locked or closed', siteCaused: true },
  { id: 'access_issue', label: "Couldn't access the site (gate, no room for the truck)", siteCaused: true },
  { id: 'wrong_address', label: 'Wrong or incomplete address', siteCaused: true },
  { id: 'refused', label: 'Refused at the site', siteCaused: true },
  { id: 'unsafe_to_unload', label: 'Unsafe to unload', siteCaused: true },
  { id: 'damaged', label: 'Material damaged in transit', siteCaused: false },
  { id: 'vehicle_issue', label: 'Vehicle problem', siteCaused: false },
  { id: 'other', label: 'Other', siteCaused: false },
];

/** Why a driver declines an assignment or releases a job they had accepted. */
export const DECLINE_REASONS: { id: DeclineReasonId; label: string }[] = [
  { id: 'too_far', label: 'Too far from my area' },
  { id: 'load_too_large', label: 'The load is too large for my vehicle' },
  { id: 'vehicle_issue', label: 'Vehicle problem' },
  { id: 'schedule_conflict', label: 'Schedule conflict' },
  { id: 'store_delay', label: 'The store is running late' },
  { id: 'other', label: 'Other' },
];

/** One-tap messages in the dispatch ↔ driver chat. */
export const QUICK_REPLIES = [
  'On my way to the store',
  'Loading now',
  "Store says the order isn't ready",
  'On my way to the site',
  'Arrived — nobody on site',
  'Need help unloading',
  'Vehicle issue, please advise',
] as const;

export function failureReasonLabel(id: string | null | undefined): string {
  return FAILURE_REASONS.find((reason) => reason.id === id)?.label ?? 'Other';
}

export function declineReasonLabel(id: string | null | undefined): string {
  return DECLINE_REASONS.find((reason) => reason.id === id)?.label ?? 'Other';
}

/**
 * True when the jobsite caused the failure (nobody there, locked, no access, wrong address, refused,
 * unsafe). An unknown or missing reason counts as not site-caused, like `other`: ops review it.
 */
export function isSiteCausedFailure(id: string | null | undefined): boolean {
  return FAILURE_REASONS.find((reason) => reason.id === id)?.siteCaused ?? false;
}

// ---------- notifications (§5.8) ----------

/**
 * Android notification channels. The driver app creates `jobs`, `assignments`, `chat` and `updates`;
 * the customer app `orders`, `chat` and `updates` (plus its own `promotions`, which no type here uses).
 * `store` has no device yet: suppliers work in the web portal.
 */
export type NotificationChannel = 'jobs' | 'assignments' | 'orders' | 'store' | 'chat' | 'updates';

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  'jobs',
  'assignments',
  'orders',
  'store',
  'chat',
  'updates',
];

/** A push preference the user can switch in Settings. */
export type PushPreference = keyof UserPreferences;

/**
 * What applies while a user has not touched a switch. Everything is on except promotions, which need an
 * explicit opt-in at sign-up (CASL).
 */
export const PUSH_PREFERENCE_DEFAULTS: Record<PushPreference, boolean> = {
  chatPush: true,
  deliveryPush: true,
  orderPush: true,
  promoPush: false,
  jobPush: true,
  storeOrderPush: true,
};

/**
 * The §5.8 rules, one row per type: `jobs` is job_*, `assignments` the three hand-over types, `orders`
 * the customer order group, `store` store_order_* and store_issue, `chat` chat and support, `updates`
 * everything else. `jobPush` gates job_*, `storeOrderPush` store_*, `orderPush` the customer order
 * group, `chatPush` chat and support, and `deliveryPush` delivery_* (staff only, see
 * `pushPreferenceFor`). A row with `null` is always pushed.
 */
const NOTIFICATION_RULES: Record<
  NotificationType,
  { channel: NotificationChannel; preference: PushPreference | null }
> = {
  delivery_assigned: { channel: 'assignments', preference: 'deliveryPush' },
  delivery_unassigned: { channel: 'assignments', preference: 'deliveryPush' },
  delivery_cancelled: { channel: 'assignments', preference: 'deliveryPush' },
  delivery_updated: { channel: 'updates', preference: 'deliveryPush' },
  delivery_declined: { channel: 'updates', preference: 'deliveryPush' },
  delivery_failed: { channel: 'updates', preference: 'deliveryPush' },
  delivery_delivered: { channel: 'updates', preference: 'deliveryPush' },
  chat_message: { channel: 'chat', preference: 'chatPush' },
  driver_signup: { channel: 'updates', preference: null },
  account_approved: { channel: 'updates', preference: null },
  account_suspended: { channel: 'updates', preference: null },
  order_placed: { channel: 'orders', preference: 'orderPush' },
  order_update: { channel: 'orders', preference: 'orderPush' },
  order_delivered: { channel: 'orders', preference: 'orderPush' },
  order_cancelled: { channel: 'orders', preference: 'orderPush' },
  order_store_update: { channel: 'orders', preference: 'orderPush' },
  pickup_ready: { channel: 'orders', preference: 'orderPush' },
  refund_issued: { channel: 'orders', preference: 'orderPush' },
  quote_update: { channel: 'orders', preference: 'orderPush' },
  issue_update: { channel: 'orders', preference: 'orderPush' },
  support_reply: { channel: 'chat', preference: 'chatPush' },
  store_order_new: { channel: 'store', preference: 'storeOrderPush' },
  store_order_reminder: { channel: 'store', preference: 'storeOrderPush' },
  store_order_update: { channel: 'store', preference: 'storeOrderPush' },
  store_issue: { channel: 'store', preference: 'storeOrderPush' },
  job_offer: { channel: 'jobs', preference: 'jobPush' },
  job_update: { channel: 'jobs', preference: 'jobPush' },
  payout_sent: { channel: 'updates', preference: null },
  vehicle_review: { channel: 'updates', preference: null },
  store_order_late: { channel: 'store', preference: 'storeOrderPush' },
  job_unclaimed: { channel: 'jobs', preference: 'jobPush' },
  quote_new: { channel: 'updates', preference: null },
  issue_new: { channel: 'updates', preference: null },
  support_message: { channel: 'chat', preference: 'chatPush' },
  // Not a store order, but the rule is the store_ prefix; the type is silent (inbox only) anyway.
  store_suggestion: { channel: 'updates', preference: 'storeOrderPush' },
  capture_failed: { channel: 'updates', preference: null },
  test: { channel: 'updates', preference: null },
  system: { channel: 'updates', preference: null },
};

/** Every notification type, in the order of the table above. */
export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_RULES) as NotificationType[];

/** A type written by a newer build than the reader's is not in the table; it must not crash the reader. */
function notificationRule(type: NotificationType) {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_RULES, type) ? NOTIFICATION_RULES[type] : null;
}

/** The Android channel a notification is posted to. Unknown types go to `updates`. */
export function channelFor(type: NotificationType): NotificationChannel {
  return notificationRule(type)?.channel ?? 'updates';
}

/**
 * The preference that can mute the push for a type, or null when it is always pushed. `deliveryPush` is
 * a staff preference: a driver cannot mute the pushes that hand them work, so for drivers delivery_*
 * is always pushed.
 */
export function pushPreferenceFor(type: NotificationType, role?: Role | null): PushPreference | null {
  const preference = notificationRule(type)?.preference ?? null;
  return preference === 'deliveryPush' && role === 'driver' ? null : preference;
}

/** Whether a notification may be pushed to this user. The inbox entry is written either way. */
export function isPushAllowed(
  type: NotificationType,
  preferences: UserPreferences | null | undefined,
  role?: Role | null,
): boolean {
  const preference = pushPreferenceFor(type, role);
  if (preference === null) return true;
  return preferences?.[preference] ?? PUSH_PREFERENCE_DEFAULTS[preference];
}

/**
 * The keys of a notification's `data` that the apps open a screen for. `data` can hold other strings
 * as well; only these are routed on.
 */
export const NOTIFICATION_DATA_KEYS = [
  'customerOrderId',
  'storeOrderId',
  'deliveryId',
  'quoteId',
  'issueId',
  'threadId',
  'payoutId',
] as const;

export type NotificationDataKey = (typeof NOTIFICATION_DATA_KEYS)[number];
