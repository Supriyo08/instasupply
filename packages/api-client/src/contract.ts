/**
 * The REST contract of PLATFORM §5.4, names and fields unchanged.
 *
 * Why a local copy: PLATFORM §16 row 11 moves these types into `@instasupply/shared` (`src/rest.ts`).
 * Until that file exists the client declares them once, here; when it lands, this file becomes
 * `export type { … } from '@instasupply/shared'` and nothing else in the package changes.
 */
import type {
  AccountType,
  Cart,
  CardBrand,
  Category,
  CustomerContact,
  DevicePlatform,
  DimsCm,
  JobsiteFields,
  LatLng,
  Priority,
  ProductBadge,
  Role,
  SellUnit,
  CategoryId,
  Store,
  StoreOrderStatus,
  SupportContext,
  UserPreferences,
  UserProfile,
} from '@instasupply/shared';

import type { AuthFailureReason, ServerErrorStatus } from './errors';

// ---------- lists and ids ----------
export interface Page<T> {
  items: T[];
  /** Pass it back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null;
}
/** Every document the API returns carries its id, also where the shared type has no `id` field (B10). */
export type WithId<T> = T & { id: string };

// ---------- errors ----------
export type ApiStatus = ServerErrorStatus;
export interface ApiErrorBody {
  error: { status: ApiStatus; code: string | null; message: string; details: Record<string, unknown> };
}
export type { AuthFailureReason };

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
  /** E.164. "Call support" in the customer app, "Call dispatch" in the driver app. */
  supportPhone: string | null;
  supportEmail: string | null;
  /** Printed on receipts. */
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
  /** Lifetime in seconds (900). The client keeps its own deadline on its own clock. */
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
  store: WithId<Store> | null;
  serverTime: number;
}
/** The server always includes `me`; the client still copes without it (it then calls GET /me). */
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
  /** 1–200, required for suspended. */
  reason: string | null;
}
export interface PayoutAccountPatch {
  payoutAccount: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null;
}

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

// ---------- driver location (CLIENTS §5.2) ----------
export interface Fix {
  lat: number;
  lng: number;
  /** Degrees clockwise from north; null when unknown. */
  heading: number | null;
  /** Metres per second; null when unknown. */
  speed: number | null;
  /** Horizontal accuracy in metres; null when unknown. */
  accuracy: number | null;
  /** When the device took the fix, epoch ms. */
  at: number;
}
export type TrackingMode = 'normal' | 'live';
export interface LocationReport {
  online: boolean;
  mode: TrackingMode;
  /** 0 to 1, or null. */
  battery: number | null;
  /** Oldest first, 1 to 20. May be empty only when `online` is false and no fix was ever taken. */
  fixes: Fix[];
}
export interface LocationAck {
  /** False when the server will not treat this driver as online (not approved, suspended). */
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
  unload?: { status: 'not_needed' | 'needed' | 'booked'; labourerName: string | null; labourerPhone: string | null };
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

// ---------- files (CLIENTS §1.8) ----------
export type UploadPurpose = 'proof' | 'quote_upload' | 'issue_photo' | 'store_photo' | 'product_photo' | 'avatar';
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
  /** Storage path with the MARKETPLACE §6.4 prefix, e.g. `issuePhotos/6f1c…/a2c4….jpg`. Pass it to the command. */
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
  today: { orders: number; gmvCents: number };
  storeOrdersByStatus: Partial<Record<StoreOrderStatus, number>>;
  acceptOverdue: number;
  jobOffers: { scheduled: number; open: number; unclaimedOver15Min: number };
  activeDeliveries: number;
  failedDeliveries: number;
  liveStores: number;
  quotes: { waiting: number; nearRespondBy: number };
  issues: { open: number; pastSla: number };
  unreadSupport: number;
  captureFailures: number;
  pendingDrivers: number;
  unreadDriverChat: number;
  generatedAt: number;
}
export interface OpsStoreRow {
  store: WithId<Store>;
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
/** A superset of the shared `DevOutboxMessage` (which knows SMS only). */
export interface OutboxMessage {
  id: string;
  channel: 'sms' | 'email';
  to: string;
  subject: string | null;
  /** Null when redacted: a sensitive message that a real provider delivered. */
  body: string | null;
  purpose: 'otp' | 'tracking_link' | 'store_alert' | 'other' | 'password_reset' | 'invite';
  provider: 'outbox' | 'twilio' | 'resend' | 'smtp';
  status: 'stored' | 'sent' | 'failed';
  createdAt: number;
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
  payload: unknown;
}
