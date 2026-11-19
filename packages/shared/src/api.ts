/**
 * Request/response contracts for the callable Cloud Functions (§5.3). Clients and functions both import
 * these, so a contract change is a compile error on both sides. `CallableContracts` at the end pairs
 * every name in `CALLABLES` with its request and response.
 *
 * Ids that a client may retry (`checkoutId`, `requestId`, `issueId`) are UUIDv4s made on the device and
 * used as document ids, so a lost response never creates a second order, quote or issue (D17).
 */
import type { DimsCm, SellUnit, Store, StorePrivateSettings } from './catalog';
import type { CallableName } from './constants';
import type { FaultParty, IssueType } from './issues';
import type { CityId } from './market';
import type {
  CartLine,
  Contact,
  Fulfilment,
  Receiving,
  ShortReason,
  StoreOrderStatus,
  StoreRejectReason,
} from './marketplace';
import type { QuoteAttachment, QuoteRequest } from './quotes';
import type {
  AccountStatus,
  AccountType,
  DeclineReasonId,
  DeliveryStatus,
  FailureReasonId,
  LatLng,
  RouteProvider,
  StaffRole,
  StoreRole,
} from './types';
import type { DeliveryInput } from './validation';
import type { VehicleClass, VehicleExtra, VehicleType } from './vehicles';

export interface OkResponse {
  ok: true;
}

// ---------- accounts ----------

export interface RegisterCustomerRequest {
  displayName: string;
  companyName?: string | null;
  accountType?: AccountType | null;
  /** "Send me deals": becomes `preferences.promoPush`. Off unless ticked (CASL). */
  marketingOptIn?: boolean;
}
export interface RegisterCustomerResponse {
  status: AccountStatus;
}

export interface RequestPhoneOtpRequest {
  phoneNumber: string;
}
export interface RequestPhoneOtpResponse {
  phoneNumber: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Only returned by the local emulator, to make testing easy. */
  devCode?: string;
}

export interface VerifyPhoneOtpRequest {
  code: string;
}
export interface VerifyPhoneOtpResponse {
  phoneNumber: string;
}

export interface CreateStaffUserRequest {
  email: string;
  displayName: string;
  role: StaffRole;
}
export interface CreateStaffUserResponse {
  uid: string;
  /** Link the new teammate uses to choose a password. */
  passwordSetupLink: string;
}

// ---------- customer: checkout ----------

export interface PlaceOrderRequest {
  /** Becomes the order id and the card authorization's idempotency key. */
  checkoutId: string;
  items: CartLine[];
  fulfilment: Fulfilment;
  /** Required for delivery, null for pickup. */
  jobsiteId: string | null;
  /** `asap` or a slot start `YYYY-MM-DDTHH:MM` (Toronto); null for pickup. */
  windowId: string | null;
  receiving: Receiving | null;
  siteContact: Contact | null;
  instructions: string | null;
  /** Stores the customer wants a labourer for ("Need help unloading?"). */
  unloadHelpStoreIds: string[];
  cardId: string;
  promoCode: string | null;
  /** The total the customer saw. The server re-prices and refuses a different total with `PRICE_CHANGED`. */
  expectedTotalCents: number;
}
export interface PlaceOrderResponse {
  orderId: string;
  number: string;
  totalCents: number;
  storeOrders: { storeOrderId: string; number: string; storeId: string }[];
}

export interface CancelOrderRequest {
  orderId: string;
  /** Null or missing: every store order of the order. */
  storeOrderIds?: string[] | null;
  reason?: string | null;
}
export interface CancelOrderResponse {
  cancelled: string[];
  /** A customer can cancel a store order only while it is `new` or `accepted`. */
  notCancellable: { storeOrderId: string; status: StoreOrderStatus }[];
}

// ---------- supplier ----------

/** A short shipment: the store can supply fewer units than ordered (§2.1.1). Quantities only go down. */
export interface LineAdjustment {
  lineId: string;
  fulfilledQty: number;
  reason: ShortReason;
}

/**
 * Every store-order action sends the `version` it saw; a stale one fails with `VERSION_CONFLICT`, so
 * two people working the same order cannot overwrite each other.
 */
export interface AcceptStoreOrderRequest {
  storeOrderId: string;
  expectedVersion: number;
  adjustments?: LineAdjustment[];
  note?: string | null;
}
export interface UpdateStoreOrderStatusRequest {
  storeOrderId: string;
  expectedVersion: number;
  status: 'preparing' | 'ready';
  adjustments?: LineAdjustment[];
  note?: string | null;
}
export interface RejectStoreOrderRequest {
  storeOrderId: string;
  expectedVersion: number;
  reason: StoreRejectReason;
  note?: string | null;
}
export interface StoreOrderActionResponse {
  status: StoreOrderStatus;
  version: number;
}

export interface CompletePickupRequest {
  storeOrderId: string;
  expectedVersion: number;
  /** The driver's or the customer's 4-digit PIN. */
  pickupCode: string | null;
  adjustments?: LineAdjustment[];
  /** Staff only: completes the hand-over without the PIN, and is recorded. */
  overrideReason?: string | null;
}
export interface CompletePickupResponse {
  status: 'out_for_delivery' | 'picked_up';
}

/** What a store owner may change about their own store. Name, address, radius and status are ops-only. */
export type StoreProfilePatch = Partial<
  Pick<
    Store,
    | 'description'
    | 'phone'
    | 'email'
    | 'hours'
    | 'closures'
    | 'prepMinutes'
    | 'sameDayCutoff'
    | 'acceptingOrders'
  >
> & {
  fulfilment?: { delivery?: boolean; pickup?: boolean };
  /** `storePhotos/{storeId}/…`; the server sets `photoUrl` from it. */
  photoPath?: string | null;
  /** Saved to `private/settings`. */
  loadingNotes?: string | null;
  /** Saved to `private/settings`. */
  alertPhone?: string | null;
};
export interface UpdateStoreProfileRequest {
  storeId: string;
  patch: StoreProfilePatch;
}

export interface CreateStoreRequest {
  storeId: string;
  store: Omit<Store, 'id' | 'rating' | 'ratingCount' | 'createdAt' | 'updatedAt'>;
  settings: StorePrivateSettings;
}
export interface UpdateStoreSettingsRequest {
  storeId: string;
  store?: Partial<
    Pick<
      Store,
      | 'name'
      | 'specialty'
      | 'categoryIds'
      | 'description'
      | 'address'
      | 'location'
      | 'cityId'
      | 'areaLabel'
      | 'status'
    >
  > & { deliveryRadiusKm?: number };
  settings?: Partial<StorePrivateSettings>;
}

export interface InviteSupplierUserRequest {
  storeId: string;
  email: string;
  displayName: string;
  storeRole: StoreRole;
}
export interface InviteSupplierUserResponse {
  uid: string;
  passwordSetupLink: string;
}
export interface SetSupplierUserStatusRequest {
  uid: string;
  status: 'active' | 'suspended';
  reason?: string | null;
}

// ---------- driver ----------

/** What a driver declares. The server derives `capacityClass` from it; staff may override that. */
export interface DriverVehicleInput {
  type: VehicleType;
  make: string;
  model: string;
  year: number;
  plate: string;
  colour: string | null;
  boxLengthFt: 5.5 | 6.5 | 8 | null;
  payloadKg: number | null;
  extras: VehicleExtra[];
}

export interface RegisterDriverRequest {
  displayName: string;
  cityId: CityId;
  vehicle: DriverVehicleInput;
  /** All three must be ticked. No licence or insurance images are stored (PIPEDA). */
  attestations: { licence: true; insurance: true; terms: true };
}
export interface RegisterDriverResponse {
  status: AccountStatus;
}

/** Goes to `vehicleDraft` until staff review it. */
export interface UpdateDriverVehicleRequest {
  vehicle: DriverVehicleInput;
}
export interface ReviewDriverVehicleRequest {
  uid: string;
  approve: boolean;
  capacityClass?: VehicleClass | null;
  note?: string | null;
}

export interface SetDriverStatusRequest {
  uid: string;
  status: 'active' | 'suspended';
  reason?: string | null;
  capacityClass?: VehicleClass | null;
  licenceVerified?: boolean;
  insuranceVerified?: boolean;
  /** Emulator only: approve without the two compliance checks. */
  force?: boolean;
}

export interface ClaimJobRequest {
  deliveryId: string;
}
export interface ClaimJobResponse {
  deliveryId: string;
  status: 'accepted';
}

export interface CheckInAtStoreRequest {
  deliveryId: string;
  location?: LatLng | null;
}

// ---------- deliveries ----------

export interface CreateDeliveriesRequest {
  deliveries: Partial<DeliveryInput>[];
}
export interface CreateDeliveriesResponse {
  created: { index: number; id: string; orderId: string; trackingToken: string }[];
  errors: { index: number; message: string }[];
}

export interface AssignDeliveryRequest {
  deliveryId: string;
  /** null unassigns the delivery. */
  driverId: string | null;
  note?: string | null;
  /** Assign although the driver's vehicle is smaller than the job needs (`VEHICLE_TOO_SMALL` otherwise). */
  force?: boolean;
}

export interface UpdateDeliveryStatusRequest {
  deliveryId: string;
  status: DeliveryStatus;
  failureReason?: FailureReasonId | null;
  /** Also the reason when a driver releases a job they had accepted. */
  declineReason?: DeclineReasonId | null;
  note?: string | null;
  location?: LatLng | null;
}
export interface UpdateDeliveryStatusResponse {
  status: DeliveryStatus;
}

export interface CompleteDeliveryRequest {
  deliveryId: string;
  recipientName?: string | null;
  handoffCode?: string | null;
  /** `proofs/{deliveryId}/…`. A driver must send one on a marketplace delivery (`PHOTO_REQUIRED`). */
  photoPath?: string | null;
  note?: string | null;
  location?: LatLng | null;
}

export interface ResolveFailedDeliveryRequest {
  storeOrderId: string;
  action: 'reattempt' | 'return_to_store';
  /** Re-attempt only: a new delivery window. */
  windowId?: string | null;
  /** Return only: do not charge the delivery and labourer fees although the site caused the failure. */
  refundDeliveryFee?: boolean;
  note?: string | null;
}

/** P1. */
export interface BoostJobPayoutRequest {
  deliveryId: string;
  addCents: 500 | 1000 | 1500 | 2000;
}

export interface OptimizeRouteRequest {
  /** Staff may plan for any driver; drivers always plan their own route. */
  driverId?: string;
  origin?: LatLng | null;
}
export interface OptimizeRouteResponse {
  stops: number;
  totalSeconds: number;
  totalMeters: number;
  provider: RouteProvider;
}

// ---------- quotes ----------

export interface SubmitMaterialListRequest {
  /** Becomes the quote id. */
  requestId: string;
  lines: { text: string; quantity: number | null }[];
  attachments: QuoteAttachment[];
  neededBy: QuoteRequest['neededBy'];
  fulfilment: Fulfilment;
  jobsiteId: string | null;
  contact: QuoteRequest['contact'];
  notes: string | null;
}
export interface SubmitMaterialListResponse {
  quoteId: string;
  number: string;
  /** Epoch ms. */
  respondBy: number;
}

export type QuoteLineInput =
  | {
      kind: 'catalog';
      productId: string;
      quantity: number;
      /** null: the list price. A number is a price the store agreed to for this quote. */
      unitPriceCents: number | null;
      note: string | null;
      requestLine: number | null;
    }
  | {
      /** A special order that is not in the catalogue, so it carries its own weight and size (D16). */
      kind: 'custom';
      storeId: string;
      name: string;
      unit: SellUnit;
      size: string | null;
      quantity: number;
      unitPriceCents: number;
      weightKg: number;
      dimsCm: DimsCm;
      note: string | null;
      requestLine: number | null;
    };

export interface SendQuoteRequest {
  quoteId: string;
  /** The current offer version, 0 if none: two people cannot send over each other (`QUOTE_VERSION`). */
  expectedVersion: number;
  lines: QuoteLineInput[];
  unmatched: { requestLine: number; text: string; reason: string }[];
  fulfilment: Fulfilment;
  receiving: Receiving | null;
  windowId: string | null;
  unloadHelpStoreIds: string[];
  message: string | null;
  validHours: 24 | 48 | 72;
}

export interface AcceptQuoteRequest {
  quoteId: string;
  /** The offer version the customer is looking at. */
  version: number;
  /** Becomes the order id, like `PlaceOrderRequest.checkoutId`. */
  checkoutId: string;
  cardId: string;
  /** null: the window of the offer. */
  windowId: string | null;
  receiving: Receiving | null;
  siteContact: Contact | null;
  instructions: string | null;
  unloadHelpStoreIds?: string[];
  expectedTotalCents: number;
}
/** Accepting a quote places an order through the same writer as checkout, so it answers like `placeOrder`. */
export type AcceptQuoteResponse = PlaceOrderResponse;

export interface CloseQuoteRequest {
  quoteId: string;
  reason?: string | null;
}
export interface ReopenQuoteRequest {
  quoteId: string;
  message: string | null;
}

// ---------- issues ----------

export interface ReportIssueRequest {
  /** Becomes the issue id. */
  issueId: string;
  storeOrderId: string;
  type: IssueType;
  lines: { lineId: string; quantity: number }[];
  description: string;
  /** `issuePhotos/{issueId}/…`. */
  photoPaths: string[];
  preferredResolution: 'replacement' | 'refund' | 'return';
}
export interface ReportIssueResponse {
  issueId: string;
  number: string;
}

export interface ResolveIssueRequest {
  issueId: string;
  kind: 'refund' | 'replacement' | 'no_action';
  /** Defaults to the reported lines. */
  lines?: { lineId: string; quantity: number }[];
  refundDeliveryFee?: boolean;
  returnRequired?: boolean;
  faultParty: FaultParty | null;
  note: string;
}
export interface ResolveIssueResponse {
  refundCents: number;
  replacementOrderId: string | null;
}

// ---------- misc ----------

export interface SuggestStoreRequest {
  storeName: string;
  city: string;
  /** From `SUGGEST_STORE_INTERESTS`. */
  interests: string[];
  email: string | null;
}

export interface GeocodeAddressRequest {
  query: string;
  /** Bias results towards this point (e.g. the map center). */
  near?: LatLng | null;
}
export interface GeocodeAddressResponse {
  results: {
    label: string;
    location: LatLng;
    line1: string | null;
    city: string | null;
    postalCode: string | null;
    cityId: CityId;
    areaLabel: string;
  }[];
}

export interface SendTestNotificationResponse {
  devices: number;
}

export type ScheduledJobName =
  | 'escalateStoreOrders'
  | 'expirePickupHolds'
  | 'publishDueJobOffers'
  | 'markStaleDriversOffline'
  | 'expireQuotes'
  | 'runDailyPayouts'
  | 'captureDuePayments';

export interface RunJobNowRequest {
  job: ScheduledJobName;
  /** Epoch ms the job should believe it is: time travel for tests and the seed. Default: the real time. */
  now?: number | null;
}
export interface RunJobNowResponse {
  job: ScheduledJobName;
  now: number;
  /** Counts of what the run did, e.g. `{ reminded: 1, rejected: 0 }`. */
  result: Record<string, number>;
}

// ---------- every callable with its contract ----------

/**
 * Request and response of each callable, keyed by its name in `CALLABLES`. §5.3 gives no response for
 * the callables that only change something; they answer `OkResponse`, like the existing ones.
 */
export interface CallableContracts {
  registerCustomer: { request: RegisterCustomerRequest; response: RegisterCustomerResponse };
  registerDriver: { request: RegisterDriverRequest; response: RegisterDriverResponse };
  requestPhoneOtp: { request: RequestPhoneOtpRequest; response: RequestPhoneOtpResponse };
  verifyPhoneOtp: { request: VerifyPhoneOtpRequest; response: VerifyPhoneOtpResponse };
  createStaffUser: { request: CreateStaffUserRequest; response: CreateStaffUserResponse };
  setDriverStatus: { request: SetDriverStatusRequest; response: OkResponse };
  updateDriverVehicle: { request: UpdateDriverVehicleRequest; response: OkResponse };
  reviewDriverVehicle: { request: ReviewDriverVehicleRequest; response: OkResponse };
  inviteSupplierUser: { request: InviteSupplierUserRequest; response: InviteSupplierUserResponse };
  setSupplierUserStatus: { request: SetSupplierUserStatusRequest; response: OkResponse };
  placeOrder: { request: PlaceOrderRequest; response: PlaceOrderResponse };
  cancelOrder: { request: CancelOrderRequest; response: CancelOrderResponse };
  acceptStoreOrder: { request: AcceptStoreOrderRequest; response: StoreOrderActionResponse };
  updateStoreOrderStatus: { request: UpdateStoreOrderStatusRequest; response: StoreOrderActionResponse };
  rejectStoreOrder: { request: RejectStoreOrderRequest; response: StoreOrderActionResponse };
  completePickup: { request: CompletePickupRequest; response: CompletePickupResponse };
  updateStoreProfile: { request: UpdateStoreProfileRequest; response: OkResponse };
  createStore: { request: CreateStoreRequest; response: OkResponse };
  updateStoreSettings: { request: UpdateStoreSettingsRequest; response: OkResponse };
  createDeliveries: { request: CreateDeliveriesRequest; response: CreateDeliveriesResponse };
  assignDelivery: { request: AssignDeliveryRequest; response: OkResponse };
  updateDeliveryStatus: { request: UpdateDeliveryStatusRequest; response: UpdateDeliveryStatusResponse };
  completeDelivery: { request: CompleteDeliveryRequest; response: OkResponse };
  claimJob: { request: ClaimJobRequest; response: ClaimJobResponse };
  checkInAtStore: { request: CheckInAtStoreRequest; response: OkResponse };
  resolveFailedDelivery: { request: ResolveFailedDeliveryRequest; response: OkResponse };
  boostJobPayout: { request: BoostJobPayoutRequest; response: OkResponse };
  optimizeRoute: { request: OptimizeRouteRequest; response: OptimizeRouteResponse };
  geocodeAddress: { request: GeocodeAddressRequest; response: GeocodeAddressResponse };
  submitMaterialList: { request: SubmitMaterialListRequest; response: SubmitMaterialListResponse };
  sendQuote: { request: SendQuoteRequest; response: OkResponse };
  acceptQuote: { request: AcceptQuoteRequest; response: AcceptQuoteResponse };
  closeQuote: { request: CloseQuoteRequest; response: OkResponse };
  reopenQuote: { request: ReopenQuoteRequest; response: OkResponse };
  reportIssue: { request: ReportIssueRequest; response: ReportIssueResponse };
  resolveIssue: { request: ResolveIssueRequest; response: ResolveIssueResponse };
  suggestStore: { request: SuggestStoreRequest; response: OkResponse };
  sendTestNotification: { request: void; response: SendTestNotificationResponse };
  runJobNow: { request: RunJobNowRequest; response: RunJobNowResponse };
}

/** `RequestOf<'placeOrder'>` is `PlaceOrderRequest`; lets one typed helper call every callable. */
export type RequestOf<Name extends CallableName> = CallableContracts[Name]['request'];
export type ResponseOf<Name extends CallableName> = CallableContracts[Name]['response'];

// `CALLABLES` and `CallableContracts` must list the same names. When one is missing on either side,
// the second line stops compiling.
type AssertTrue<T extends true> = T;
type _EveryCallableHasAContract = AssertTrue<
  [CallableName] extends [keyof CallableContracts]
    ? [keyof CallableContracts] extends [CallableName]
      ? true
      : false
    : false
>;
