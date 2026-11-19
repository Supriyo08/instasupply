/**
 * Types of the REST contract (docs/PLATFORM.md §5.4): the wire shapes of the REST endpoints, the error
 * envelope and the platform endpoints. The commands (`POST /api/v1/call/<name>`) keep their contracts in
 * `api.ts`. Every `number` that ends in `At`, `Since`, `Until` or is called `serverTime` is epoch
 * milliseconds; money is integer cents.
 */
import type { CardBrand } from './cards';
import type { Category, CategoryId, DimsCm, ProductBadge, SellUnit, Store } from './catalog';
import type { ErrorCode } from './errors';
import type { Cart, JobsiteFields, StoreOrderStatus } from './marketplace';
import type { SupportContext } from './support';
import type {
  AccountType,
  CustomerContact,
  DevicePlatform,
  LatLng,
  Priority,
  Role,
  UserPreferences,
  UserProfile,
} from './types';

// ---------- lists and ids ----------

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
/**
 * Every document the API returns carries `id`, also where the shared type has none: the old document id.
 * JobOffer → deliveryId · ChatThread, DriverLocation → the driver's uid · StoreReview → storeOrderId ·
 * Favorite → productId · SupportThread, LedgerEntry, Payout, StoreSuggestion → their id.
 * UserProfile keeps `uid`; PublicTracking, RoutePlan and Cart are fetched by key and carry no extra id.
 */
export type WithId<T> = T & { id: string };

// ---------- errors ----------

/** The eight HttpsError-style statuses, plus `unavailable` (HTTP 503, platform only: retry later). */
export type ApiStatus =
  | 'invalid-argument'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'internal'
  | 'unavailable';
export interface ApiErrorBody {
  error: {
    status: ApiStatus;
    /** The ERROR_CODES value when the failure has one (MARKETPLACE §5.9), else null. */
    code: ErrorCode | null;
    /** Written for the user. Apps may show it as is. */
    message: string;
    /** Always an object. Carries what MARKETPLACE §5.9 lists per code (pricing, windows, version, remaining, …). */
    details: Record<string, unknown>;
  };
}

// ---------- platform ----------

export interface HealthResponse {
  status: 'ok';
  version: string;
  serverTime: number;
}
export interface PublicConfig {
  environment: 'development' | 'production';
  paymentsMode: 'test' | 'stripe' | 'disabled';
  /** required: checkout needs a verified phone. optional: offered, never blocking. off: hidden. */
  phoneVerification: 'required' | 'optional' | 'off';
  /** E.164. */
  supportPhone: string | null;
  supportEmail: string | null;
  hstNumber: string | null;
  map: { tileUrl: string; attribution: string; maxZoom: number };
  /** The public tracking link is `${trackingBaseUrl}/${token}`. */
  trackingBaseUrl: string;
  smsDriver: 'outbox' | 'twilio';
  emailDriver: 'outbox' | 'resend' | 'smtp';
  /** Shows "Run payouts now" and allows `runJobNow`. */
  allowTestJobs: boolean;
  serverTime: number;
}

// ---------- auth ----------

export type ClientApp = 'customer' | 'driver' | 'console';
export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  installationId: string;
  app: ClientApp;
}
export interface LoginRequest {
  email: string;
  password: string;
  installationId: string;
  app: ClientApp;
}
export interface SetupPasswordRequest {
  token: string;
  password: string;
  installationId: string;
  app: ClientApp;
}
export interface AuthTokens {
  accessToken: string;
  /** Lifetime in seconds (900). Clients keep their own deadline on their own clock. */
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  sessionId: string;
}
export interface MeResponse {
  account: { uid: string; email: string; createdAt: number };
  /** Null until `registerCustomer` or `registerDriver` gave the account a role. */
  profile: UserProfile | null;
  /** Suppliers only: the public document of their store. */
  store: Store | null;
  serverTime: number;
}
/** The server always includes `me`. */
export interface AuthSessionResponse extends AuthTokens {
  me?: MeResponse;
}
export interface InviteInfo {
  email: string;
  displayName: string;
  role: Role;
  expiresAt: number;
}
export interface SessionInfo {
  id: string;
  app: ClientApp;
  platform: DevicePlatform | null;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}
export interface UserStatusPatch {
  status: 'active' | 'suspended';
  /** 1–200 characters, required for suspended. */
  reason: string | null;
}
export interface PayoutAccountPatch {
  payoutAccount: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null;
}
/** `details.reason` of an auth failure (PLATFORM §6.4). */
export type AuthFailureReason =
  | 'token_expired'
  | 'token_invalid'
  | 'session_revoked'
  | 'refresh_reused'
  | 'account_suspended'
  | 'credentials';

// ---------- the caller's own data ----------

export interface ProfilePatch {
  displayName?: string;
  /** A confirmed `avatar` upload of the caller, or null to remove the photo. The server derives `photoURL`. */
  photoPath?: string | null;
  /** Merged into the stored preferences. */
  preferences?: Partial<UserPreferences>;
  /** Customers only. */
  companyName?: string | null;
  accountType?: AccountType | null;
}
export type JobsiteInput = JobsiteFields & { id?: string; isDefault: boolean };
export interface CardInput {
  id?: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
  isDefault: boolean;
}
export interface Favorite {
  productId: string;
  createdAt: number;
}
export interface DeviceInput {
  token: string;
  provider: 'expo';
  platform: DevicePlatform;
  appVersion: string | null;
  deviceName: string | null;
}
export type CartInput = Omit<Cart, 'updatedAt'>;

// ---------- driver location (CLIENTS.md §5.2) ----------

export interface Fix {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  /** When the device took the fix. */
  at: number;
}
export type TrackingMode = 'normal' | 'live';
export interface LocationReport {
  online: boolean;
  mode: TrackingMode;
  battery: number | null;
  fixes: Fix[];
}
export interface LocationAck {
  /** False when the server does not treat this driver as online. */
  online: boolean;
  serverTime: number;
}

// ---------- catalogue ----------

export interface ProductInput {
  sku: string;
  name: string;
  brand: string | null;
  categoryId: CategoryId;
  unit: SellUnit;
  size: string | null;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  stockOnHand: number;
  maxPerOrder: number | null;
  weightKg: number;
  dimsCm: DimsCm;
  shipEstimated: boolean;
  active: boolean;
  imageKey: string | null;
  imagePath: string | null;
  /** Staff only (MARKETPLACE §6.3). */
  featured?: boolean;
  badge?: ProductBadge | null;
  familyKey?: string | null;
}
export type ProductPatch = Partial<Omit<ProductInput, 'sku'>>;
export type CategoryInput = Omit<Category, 'id'>;
export interface ReviewInput {
  rating: number;
  text: string;
}

// ---------- orders and deliveries ----------

export interface StoreOrderProof {
  photoUrl: string | null;
  expiresAt: number;
  recipientName: string | null;
  deliveredAt: number | null;
}
export interface DeliveryStats {
  delivered: number;
  failed: number;
}
export interface DeliveryPatch {
  customer?: CustomerContact;
  address?: string;
  location?: LatLng;
  addressNotes?: string | null;
  notes?: string | null;
  packageCount?: number;
  priority?: Priority;
  requireCode?: boolean;
  windowStart?: number | null;
  windowEnd?: number | null;
  unload?: {
    status: 'not_needed' | 'needed' | 'booked';
    labourerName: string | null;
    labourerPhone: string | null;
  };
}

// ---------- chat and support ----------

export interface ChatMessageInput {
  id: string;
  text: string;
  deliveryId: string | null;
  kind: 'text' | 'quick_reply';
}
export interface SupportMessageInput {
  id: string;
  text: string;
  context: SupportContext | null;
}
export interface SupportThreadPatch {
  status?: 'open' | 'resolved';
  assignedTo?: string | null;
}

// ---------- quotes and issues ----------

export interface AssignPatch {
  assignedTo?: string | null;
  status?: 'in_review';
}
export interface IssueNotes {
  notes: string;
  updatedAt: number;
  updatedBy: string;
}

// ---------- money ----------

export interface LedgerBalance {
  payeeType: 'store' | 'driver';
  payeeId: string;
  unpaidCents: number;
  unpaidCount: number;
  heldCents: number;
  heldCount: number;
  lastPaidAt: number | null;
}

// ---------- files (CLIENTS.md §1.8) ----------

export type UploadPurpose =
  'proof' | 'quote_upload' | 'issue_photo' | 'store_photo' | 'product_photo' | 'avatar';
/**
 * ownerId: proof → deliveryId · quote_upload → requestId · issue_photo → issueId ·
 * store_photo, product_photo → storeId · avatar → the caller's uid.
 */
export interface PresignRequest {
  purpose: UploadPurpose;
  ownerId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}
export interface PresignedUpload {
  uploadId: string;
  /** The storage path to hand to a command afterwards. */
  path: string;
  /** The server always answers 'POST': a multipart form with `fields`, then the file as the last part, named `file`. */
  method: 'POST' | 'PUT';
  url: string;
  fields: Record<string, string>;
  /** Empty for 'POST'. */
  headers: Record<string, string>;
  expiresAt: number;
}
export interface UploadedFile {
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}
export interface FileUrlResponse {
  url: string;
  expiresAt: number;
}

// ---------- ops ----------

export interface OpsDashboard {
  /** Toronto date of generatedAt; sum of current totals. */
  today: { orders: number; gmvCents: number };
  /** Store orders that are not final. */
  storeOrdersByStatus: Partial<Record<StoreOrderStatus, number>>;
  acceptOverdue: number;
  jobOffers: { scheduled: number; open: number; unclaimedOver15Min: number };
  activeDeliveries: number;
  /** Store orders in `failed`. */
  failedDeliveries: number;
  liveStores: number;
  /** Submitted or in_review; respondBy within 10 min or past. */
  quotes: { waiting: number; nearRespondBy: number };
  /** Open or in_review; slaDueAt passed. */
  issues: { open: number; pastSla: number };
  /** Support threads with unread_by_staff > 0. */
  unreadSupport: number;
  captureFailures: number;
  pendingDrivers: number;
  /** Chat threads with unread_by_staff > 0. */
  unreadDriverChat: number;
  generatedAt: number;
}
export interface OpsStoreRow {
  store: Store;
  liveProducts: number;
  ordersLast7Days: number;
  medianAcceptSeconds: number | null;
  openNow: boolean;
}
export interface JobState {
  job: string;
  schedule: string;
  nextRunAt: number;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
}
export interface OutboxEvent {
  id: number;
  event: string;
  status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: number;
  lastError: string | null;
  createdAt: number;
  finishedAt: number | null;
  payload: unknown | null;
}
