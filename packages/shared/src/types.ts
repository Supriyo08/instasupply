/**
 * Domain model shared by the API server, the web console and both apps: accounts, deliveries,
 * routes, tracking, notifications and the dispatch ↔ driver chat.
 *
 * PLATFORM NOTE (docs/PLATFORM.md): the backend is a Node API on PostgreSQL, not Firebase. Every
 * instant (`...At` field) is stored in documents and sent over the API as epoch milliseconds, so
 * `TimestampLike` is a plain number. Do not change it back to an object with `toMillis()`.
 */
import type { CityId } from './market';
import type { Receiving } from './marketplace';
import type { DriverPayout, DriverVehicle, LoadSummary, VehicleClass } from './vehicles';

export type Role = 'admin' | 'dispatcher' | 'driver' | 'customer' | 'supplier';
export type StaffRole = Extract<Role, 'admin' | 'dispatcher'>;
/** A supplier user's role inside their store (D10). */
export type StoreRole = 'owner' | 'staff';
export type AccountStatus = 'pending' | 'active' | 'suspended';
export type Priority = 'normal' | 'high' | 'urgent';

export type DeliveryStatus =
  | 'unassigned'
  | 'assigned'
  | 'accepted'
  | 'picked_up'
  | 'in_transit'
  | 'arrived'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A point in time as epoch milliseconds (UTC). The name is kept from the Firestore era so the
 * document types of the spec read unchanged; on the wire and in the database documents it is a number.
 */
export type TimestampLike = number;

export interface UserPreferences {
  /** Receive push notifications for chat and support messages. */
  chatPush?: boolean;
  /** Receive push notifications for delivery updates (staff). */
  deliveryPush?: boolean;
  /** Receive push notifications about order progress (customers). */
  orderPush?: boolean;
  /** Receive offers and promotions (customers). Off unless the customer opted in at sign-up (CASL). */
  promoPush?: boolean;
  /** Receive push notifications about jobs (drivers). */
  jobPush?: boolean;
  /** Receive push notifications about store orders (suppliers). */
  storeOrderPush?: boolean;
}

/** Custom claims set on Firebase Auth users by Cloud Functions, and only by them (§6.1). */
export interface AuthClaims {
  role?: Role;
  /** True once the account is approved and not suspended. */
  active?: boolean;
  /** Suppliers: the store they belong to. */
  storeId?: string;
  /** Suppliers: their role in that store. */
  storeRole?: StoreRole;
  /** Approved drivers: job offers are matched on `"{cityId}:{capacityClass}"` (D9). */
  cityId?: CityId;
  /** Approved drivers: the vehicle class they are trusted with. */
  capacityClass?: VehicleClass;
}

export type AccountType = 'contractor' | 'renovator' | 'builder' | 'homeowner';

/**
 * `users/{uid}`: one profile for every role. The user may edit `displayName`, `photoURL`, `preferences`
 * and, as a customer, `companyName` and `accountType`; functions write everything else (§1.2).
 */
export interface UserProfile {
  uid: string;
  role: Role;
  status: AccountStatus;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  phoneVerified: boolean;
  photoURL?: string | null;
  preferences?: UserPreferences;

  // ---------- customer ----------
  companyName?: string | null;
  accountType?: AccountType | null;
  /** Server only. `nonCancelledOrders === 0` is what makes the next order a first order (§3.5). */
  stats?: { nonCancelledOrders: number; completedOrders: number; lastOrderAt: TimestampLike | null };
  /** Server only: how often each promo code was used. */
  promoUses?: Record<string, number>;

  // ---------- supplier (copies of the claims) ----------
  storeId?: string | null;
  storeRole?: StoreRole | null;

  // ---------- driver ----------
  cityId?: CityId | null;
  /** The approved vehicle. Server only. */
  vehicle?: DriverVehicle | null;
  /** Server only, set by ops. */
  payoutAccount?: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null;
  /** A vehicle change waiting for staff review. Server only. */
  vehicleDraft?: DriverVehicle | null;
  vehicleReviewRequired?: boolean;
  /** Attestations only: no licence or insurance images are stored (PIPEDA). */
  compliance?: {
    licenceAttestedAt: TimestampLike;
    insuranceAttestedAt: TimestampLike;
    termsAcceptedAt: TimestampLike;
    licenceVerified: boolean;
    insuranceVerified: boolean;
    verifiedBy: string | null;
    verifiedAt: TimestampLike | null;
  } | null;
  /** Server only, kept by the delivery ledger. */
  driverStats?: { deliveries: number; earnedCents: number };

  suspendedReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: TimestampLike | null;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
}

export interface DriverLocation {
  lat: number;
  lng: number;
  /** Degrees clockwise from north, when known. */
  heading: number | null;
  /** Metres per second, when known. */
  speed: number | null;
  /** Horizontal accuracy in metres, when known. */
  accuracy: number | null;
  online: boolean;
  /** 0–1 when the device reports it. */
  battery?: number | null;
  updatedAt: TimestampLike;
}

export interface CustomerContact {
  name: string;
  phone: string | null;
  email?: string | null;
}

/**
 * Why a delivery failed at the jobsite (§2.3). `FAILURE_REASONS` says which ones the site caused: those
 * still pay the driver and may keep the delivery fee (§3.7, §3.10).
 */
export type FailureReasonId =
  | 'no_one_on_site'
  | 'site_closed'
  | 'access_issue'
  | 'wrong_address'
  | 'refused'
  | 'unsafe_to_unload'
  | 'damaged'
  | 'vehicle_issue'
  | 'other';

/** Why a driver declines an assignment or releases a job they had accepted (§2.3). */
export type DeclineReasonId =
  'too_far' | 'load_too_large' | 'vehicle_issue' | 'schedule_conflict' | 'store_delay' | 'other';

export interface DeliveryProof {
  recipientName: string | null;
  photoPath: string | null;
  codeVerified: boolean;
  note: string | null;
  location: LatLng | null;
}

export interface DeliveryFailure {
  reason: FailureReasonId;
  note: string | null;
}

/**
 * What a delivery gains in the marketplace (§1.3): where to collect the load, what it is, what it
 * pays and how the job reaches a driver. A manual delivery created by dispatch has `kind: 'manual'`
 * and nulls here.
 */
export interface DeliveryMarketplaceFields {
  kind: 'marketplace' | 'manual';
  storeOrderId: string | null;
  storeId: string | null;
  /** The pickup at the store. Copied at creation, so the driver app reads only deliveries (§1.4). */
  pickup: {
    storeId: string;
    storeName: string;
    address: string;
    location: LatLng;
    phone: string;
    /** The store's private loading notes (gate code, dock). */
    loadingNotes: string | null;
    readyBy: TimestampLike;
    ready: boolean;
    readyAt: TimestampLike | null;
    /** Set once by `checkInAtStore`. */
    arrivedAt: TimestampLike | null;
    /** Set when the store confirms the collection with the driver's PIN. */
    collectedAt: TimestampLike | null;
    /** The assigned driver's one-time PIN; cleared when the driver declines or releases the job. */
    pickupCode: string | null;
  } | null;
  load: LoadSummary | null;
  vehicleClass: VehicleClass | null;
  tripKm: number | null;
  /** The store's and the jobsite's city. */
  cityIds: CityId[];
  receiving: Receiving | null;
  /**
   * The driver must add a drop-off photo: true for every marketplace delivery. The hand-off code
   * (`requireCode`) is asked for as well when `receiving` is `attended`.
   */
  requirePhoto: boolean;
  /** Help with unloading at the site. Staff set `status`, name and phone when they book a labourer. */
  unload: {
    labourer: boolean;
    required: boolean;
    status: 'not_needed' | 'needed' | 'booked';
    labourerName: string | null;
    labourerPhone: string | null;
  } | null;
  payout: DriverPayout | null;
  /**
   * Mirrors the job offer (§2.4): `held` until the store accepts, `scheduled` or `open` while an offer
   * exists, `claimed` once a driver has it, `withdrawn` when cancelled before collection. Null for
   * manual deliveries.
   */
  offerStatus: 'held' | 'scheduled' | 'open' | 'claimed' | 'withdrawn' | null;
  offerOpensAt: TimestampLike | null;
  /** Uid → when that driver released this job; they cannot reclaim it for an hour. */
  releasedBy: Record<string, TimestampLike>;
}

/** One trip to a jobsite: `deliveries/{deliveryId}`. */
export interface Delivery extends DeliveryMarketplaceFields {
  id: string;
  /** Human-friendly reference: the store order number (`IS-10042-A`), or `IS-10043` for a manual delivery. */
  orderId: string;
  /** Marketplace: the site contact. */
  customer: CustomerContact;
  /** Marketplace: the jobsite. */
  address: string;
  location: LatLng;
  /** Directions for the driver. Marketplace: the jobsite instructions plus the checkout instructions. */
  addressNotes: string | null;
  /** Internal dispatch notes. */
  notes: string | null;
  packageCount: number;
  /** Marketplace: `high` for ASAP, `normal` otherwise. */
  priority: Priority;
  /** Driver must enter the customer's hand-off code to complete. */
  requireCode: boolean;
  /** Marketplace: the scheduled window; null for ASAP. */
  windowStart: TimestampLike | null;
  /** Marketplace: the end of the scheduled window, or the ASAP deliver-by time. */
  windowEnd: TimestampLike | null;
  driverId: string | null;
  driverName: string | null;
  status: DeliveryStatus;
  attempts: number;
  /** Drivers who declined this delivery (assignment suggestions skip them). */
  declinedBy?: string[];
  /** The customer's order (`orders/{orderId}`) this delivery belongs to. */
  sourceOrderId?: string | null;
  customerId?: string | null;
  proof: DeliveryProof | null;
  failure: DeliveryFailure | null;
  createdBy: string;
  /** Uid of whoever made the latest change (lets triggers tell a decline from a reassignment). */
  updatedBy: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  assignedAt?: TimestampLike | null;
  acceptedAt?: TimestampLike | null;
  pickedUpAt?: TimestampLike | null;
  startedAt?: TimestampLike | null;
  arrivedAt?: TimestampLike | null;
  deliveredAt?: TimestampLike | null;
  failedAt?: TimestampLike | null;
  cancelledAt?: TimestampLike | null;
}

/** Staff-only companion document: `deliveries/{id}/private/meta`. */
export interface DeliveryPrivateMeta {
  trackingToken: string;
  handoffCode: string;
}

export type DeliveryEventType =
  'created' | 'assigned' | 'unassigned' | 'status' | 'note' | 'customer_notified' | 'edited';

/** `system` is for schedules and cascades only; an audit event otherwise names whoever caused it (§2.3). */
export type ActorRole = Role | 'system';

export interface DeliveryEvent {
  id: string;
  deliveryId: string;
  orderId: string;
  driverId: string | null;
  type: DeliveryEventType;
  status: DeliveryStatus | null;
  fromStatus: DeliveryStatus | null;
  message: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: ActorRole;
  location: LatLng | null;
  at: TimestampLike;
}

export type RouteProvider = 'google' | 'osrm' | 'estimate';

export interface RouteStop {
  deliveryId: string;
  /**
   * A marketplace delivery that is not collected yet has two stops with the same `deliveryId`: the
   * pickup at the store, then the drop-off at the jobsite (§5.11).
   */
  kind: 'pickup' | 'dropoff';
  /** The store name for a pickup, the site contact for a drop-off. */
  title: string;
  orderId: string;
  customerName: string;
  address: string;
  location: LatLng;
  status: DeliveryStatus;
  priority: Priority;
  legSeconds: number;
  legMeters: number;
  /** Seconds from route computation until arrival at this stop. */
  arrivalOffsetSeconds: number;
}

export interface RoutePlan {
  driverId: string;
  origin: LatLng | null;
  stops: RouteStop[];
  totalSeconds: number;
  totalMeters: number;
  polyline: LatLng[];
  provider: RouteProvider;
  computedAt: TimestampLike;
}

/**
 * Every kind of inbox entry (§5.8). The Android channel and the preference that can mute the push are
 * derived from the type: see `channelFor` and `pushPreferenceFor` in constants.ts.
 */
export type NotificationType =
  // dispatch, drivers and accounts (as before)
  | 'delivery_assigned'
  | 'delivery_unassigned'
  | 'delivery_cancelled'
  | 'delivery_updated'
  | 'delivery_declined'
  | 'delivery_failed'
  | 'delivery_delivered'
  | 'chat_message'
  | 'driver_signup'
  | 'account_approved'
  | 'account_suspended'
  // customers
  | 'order_placed'
  | 'order_update'
  | 'order_delivered'
  | 'order_cancelled'
  | 'order_store_update'
  | 'pickup_ready'
  | 'refund_issued'
  | 'quote_update'
  | 'issue_update'
  | 'support_reply'
  // store members
  | 'store_order_new'
  | 'store_order_reminder'
  | 'store_order_update'
  | 'store_issue'
  // drivers
  | 'job_offer'
  | 'job_update'
  | 'payout_sent'
  | 'vehicle_review'
  // staff
  | 'store_order_late'
  | 'job_unclaimed'
  | 'quote_new'
  | 'issue_new'
  | 'support_message'
  | 'store_suggestion'
  | 'capture_failed'
  | 'test'
  | 'system';

export type PushStatus = 'pending' | 'sent' | 'partial' | 'failed' | 'no_devices' | 'skipped';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /**
   * Deep-link payload; values are strings so they survive FCM data messages. The keys the apps route on
   * are `NOTIFICATION_DATA_KEYS` (§5.8).
   */
  data: Record<string, string>;
  read: boolean;
  createdAt: TimestampLike;
  readAt?: TimestampLike | null;
  push?: {
    status: PushStatus;
    successCount: number;
    failureCount: number;
    sentAt?: TimestampLike | null;
  };
}

export type PushProvider = 'fcm' | 'expo';
export type DevicePlatform = 'ios' | 'android' | 'web';

export interface DeviceRegistration {
  token: string;
  provider: PushProvider;
  platform: DevicePlatform;
  appVersion: string | null;
  deviceName: string | null;
  createdAt?: TimestampLike;
  lastSeenAt?: TimestampLike;
}

export type ChatSenderRole = 'driver' | 'staff';

export interface ChatThread {
  driverId: string;
  driverName: string;
  lastMessage: {
    text: string;
    senderId: string;
    senderRole: ChatSenderRole;
    at: TimestampLike;
  } | null;
  unreadByDriver: number;
  unreadByStaff: number;
  updatedAt: TimestampLike;
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderRole: ChatSenderRole;
  deliveryId: string | null;
  kind: 'text' | 'quick_reply';
  createdAt: TimestampLike;
}

/** What the public tracking page says the trip is doing, including the leg to the store (§1.3). */
export type TrackingPhase =
  | 'finding_driver'
  | 'driver_assigned'
  | 'to_store'
  | 'at_store'
  | 'loaded'
  | 'to_site'
  | 'at_site'
  | 'delivered'
  | 'problem'
  | 'cancelled';

/** Public, sanitized view served at `/track/{token}`. Contains no driver PII beyond first name. */
export interface PublicTracking {
  deliveryId: string;
  orderId: string;
  kind: DeliveryMarketplaceFields['kind'];
  status: DeliveryStatus;
  phase: TrackingPhase;
  storeOrderNumber: string | null;
  customerFirstName: string;
  address: string;
  destination: LatLng;
  /** Lets the page say "Heading to Kestrel Lumber Yard". Null for a manual delivery. */
  pickup: { storeName: string; location: LatLng } | null;
  deliverBy: TimestampLike | null;
  windowLabel: string | null;
  receiving: Receiving | null;
  /** What the page tells the customer about unloading, when there is something to say. */
  unloadNote: string | null;
  driver: {
    firstName: string;
    vehicle: string | null;
    location: LatLng | null;
    heading: number | null;
    updatedAt: TimestampLike | null;
  } | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  /** How many stops the driver will make before this drop-off. */
  stopsBefore: number | null;
  handoffCode: string | null;
  timeline: { status: DeliveryStatus; at: TimestampLike }[];
  updatedAt: TimestampLike;
}

export interface DevOutboxMessage {
  id: string;
  channel: 'sms';
  to: string;
  body: string;
  /** `store_alert`: the new-order and reminder SMS to a store's `alertPhone`. */
  purpose: 'otp' | 'tracking_link' | 'store_alert' | 'other';
  createdAt: TimestampLike;
}
