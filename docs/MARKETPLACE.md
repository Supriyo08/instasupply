# InstaSupply marketplace pivot — final implementation spec

**Status:** final, implementation-ready · **Date:** 2026-11-19 · **Scope:** one team-week (§14) ·
**Audience:** every workstream. Point people at section numbers (for example "§3.4 step 5").

InstaSupply is the construction-supply marketplace for the Greater Toronto Area: contractors,
renovators, builders and homeowners search materials across **local suppliers (stores)**, buy
from several stores in one checkout, and get them **delivered to the jobsite** by gig **drivers**
(pickup at the store, drop-off at the site) or **picked up** at the store. Currency is CAD, tax is
Ontario HST 13 %, time is America/Toronto.

This spec replaces the grocery design in `docs/ARCHITECTURE.md` (K rewrites that file from this
one in §14). It keeps the strong parts of the codebase: role claims, OTP phone verification, the
delivery status machine and audit events, tracking documents with live ETA and hand-off code,
adaptive driver location, the route planner, the notification pipeline (inbox + FCM/Expo push),
dispatch↔driver chat, rules-first security, emulator seed and integration tests, and test-mode
card payments that never store card numbers.

**Sources.** The repository as of today (every module read), and the public pages
instasupply.ca, instasupply.ca/order, supplier.instasupply.ca and driver.instasupply.ca, re-read
on 2026-11-19. Site facts that shaped decisions: suppliers confirm **every** collection (driver or
customer) with a one-time **4-digit PIN**; supplier payouts are daily through Stripe, the same
day an order completes; drivers are matched to orders **in their own city**, see pickup,
drop-off, load and payout before accepting, may decline any time, confirm drop-off with a
**photo**, and are liable for the load from pickup until that photo; if nobody is on site and the
load is heavy **InstaSupply sends an unloader**; store cards show "Onboarding now", "Coming soon"
or "Joining InstaSupply"; the material-list page promises a quote "within 30 minutes" in
business hours.

**Priority tags.** Everything is **P0** (ships this week) unless tagged **P1** (stretch, cut first;
full list in §14.6).

---

## 0. Decisions

| # | Decision | Why | Trade-off |
| --- | --- | --- | --- |
| D1 | A checkout writes one `orders/{orderId}` (receipt, one card authorization, overall status), one `storeOrders/{storeOrderId}` per store (what the supplier works on), and, for delivery, one `deliveries/{deliveryId}` per store order (pickup at the store, drop-off at the jobsite). A pickup reservation **is** a pickup store order; there is no separate collection. | One payment per checkout; suppliers read only their own store orders; the tested delivery machine, tracking, route planner, hand-off code and notifications are reused. | A 4-store order is 4 trips and 4 fee lines. Multi-pickup batching is out of scope. |
| D2 | Products stay in top-level `products`, one document per store listing, id `{storeId}--{skuSlug}`. Staff curate an optional `familyKey` that groups the same item across stores ("2 stores · from $4.79"). | Reuses public rules, prefix search and the catalogue UI. Suppliers own their prices and stock. | No master catalogue or automatic SKU matching. |
| D3 | Stock is split: `stockOnHand` (supplier) and `reserved` (server). Available = `stockOnHand − reserved`, always computed, never stored. Checkout reserves, reject/cancel/short-ship releases, the store hand-over commits. | A shelf recount can never wipe out reservations; the live-stock promise holds under concurrent checkouts. | Two fields to explain in the portal ("on hand / reserved / available"). |
| D4 | All money is integer CAD cents in fields ending `Cents`. **One** pure function, `priceCheckout()` in `@instasupply/shared`, prices the cart preview, checkout, `placeOrder`, the quote builder, `sendQuote`, `acceptQuote`, the seed and the tests. The server re-prices and rejects a mismatched `expectedTotalCents` with `PRICE_CHANGED` (server pricing in the error details). | Client and server always agree to the cent; float bugs are impossible; renaming every money field turns old usages into compile errors. | Every price display changes. |
| D5 | Pricing follows the site literally: delivery is **free when the whole order's items reach $500.00**; a customer's **first order has $0 delivery** (no cap) and, if items reach $250.00, **$20 off**; a promo code never stacks with the $20 (the larger discount wins); a delivery fee "based on distance and order size" = vehicle class from the load + road km. "Need help unloading? Add a labourer" is an optional per-store add-on, **mandatory** when the site is unattended and the load is heavy. HST 13 % is computed per store order. | Faithful to the published promises and the driver FAQ. | Free delivery on big multi-store orders costs margin (open question §15). |
| D6 | Card only. Test-mode **authorize at checkout, capture once** when every store order is settled (clamped to the authorization), release the rest; refunds after capture. A `PaymentGateway` interface with a deterministic `TestGateway`; Stripe later behind `PAYMENTS_MODE=stripe`. Cash on delivery is removed everywhere. | Matches "pay in the app by credit or debit"; customers pay only for what they get; Stripe manual capture supports exactly one capture. | Supplier money waits for the slowest store in the order; scheduling stops at 6 days ahead. When the gateway's capture deadline comes first (card networks hold some authorizations for less than 7 days), the deadline sweep captures everything not void and refunds later reductions (§3.8). |
| D7 | Every coupled state change (store order ↔ delivery ↔ job offer ↔ stock) happens **inside one callable transaction**. Triggers only maintain derived projections (order aggregate, driver summary on the store order, tracking, routes, ledger, notifications) and always recompute from current documents. | No trigger-ordering bugs: a late event can never resurrect a claimed offer or move a status backwards. | Callables in different modules call each other's `stage*` helpers (§5.2). |
| D8 | The delivery machine keeps its 9 statuses. `accepted` = heading to / at the store; the **store** moves it to `picked_up` by entering the driver's one-time PIN (`completePickup`, one transaction with the store order and stock commit). Drivers can no longer go `accepted → in_transit` or `accepted → picked_up` on marketplace deliveries; they can **release** a job (`accepted → unassigned`). A `system` actor joins `driver` and `staff`. | Smallest change to a tested machine; chain of custody starts at the counter, as the supplier site describes. | No separate "at store" status (it is `pickup.arrivedAt`). |
| D9 | Drivers claim work from `jobOffers/{deliveryId}`, a sanitized copy (no customer PII) written in the same transactions that change the delivery. Visibility is enforced by rules through an `audience` array of `"{cityId}:{capacityClass}"` strings matched against driver claims. Dispatch can still `assignDelivery`. | City and vehicle matching from the driver site, race-safe claims, no PII before a claim. | One more collection. |
| D10 | Suppliers are role `supplier` with claims `storeId` and `storeRole` (`owner` \| `staff`) and use a portal inside the existing back office at `/portal`. | Reuses the web UI kit, auth, alerts and catalogue components. | One app, two audiences (lazy routes). |
| D11 | Customer and store support use a new `supportThreads` pipeline cloned from the driver chat; the driver chat (`threads/{driverId}`) is untouched. One thread per customer (`{uid}`) and one per store (`store_{storeId}`, shared by its members). | No renames in nine working files. | Two similar chat pipelines. |
| D12 | Store ratings (`stores/{storeId}/reviews/{storeOrderId}`, one per completed store order) replace product reviews. | The site rates stores ("★4.9 (50)"). | Product review screens are deleted. |
| D13 | Staging and production Firestore, Functions and the default Storage bucket in **`northamerica-northeast2` (Toronto)**. The region is set per environment everywhere it is named (§12.2): the functions env file, the client builds (GitHub `FUNCTIONS_REGION` variable → `VITE_FUNCTIONS_REGION`; `EXPO_PUBLIC_FUNCTIONS_REGION` in the `preview` and `production` profiles of both `eas.json` files) and the bootstrap (`FIRESTORE_LOCATION`). A Firestore location can't be changed, so a project whose database was created elsewhere (the bootstrap default is `nam5`) is recreated. `DEFAULT_FUNCTIONS_REGION`, the `.env.development` files and every emulator default stay `us-central1`. | Canadian data residency and latency without day-1 churn in `.env.development` files and `scripts/lib/emulator.ts`. | Two region values to remember (documented in DEPLOYMENT.md); a client built with the wrong region fails every callable. |
| D14 | America/Toronto time comes from a dependency-free DST rule in shared code (no `Intl`): EDT from the 2nd Sunday of March 07:00 UTC to the 1st Sunday of November 06:00 UTC. Store hours, ASAP promises, 2-hour windows, pickup holds and SLAs are shared pure functions; the server re-validates the chosen window. | Identical results on Hermes, browsers and Node; deterministic DST tests. | One function to change if Ontario changes its DST law. |
| D15 | Categories are the **25 app tiles** (Adhesives … Outdoors) from the app mock and the brief; the artwork already being drawn uses them. The site's 24 "What do you buy most?" names become the Suggest-a-store chips and search synonyms. | Matches the design the user asked for and the icons in `packages/art`. | Two lists (taxonomy vs. survey chips), both constants in shared. |
| D16 | A material list becomes a `quotes/{quoteId}` document. Staff build an offer from catalogue listings (with optional unit-price overrides) and **custom special-order lines** (with weight and size), priced by `priceCheckout`. Accepting runs the same order writer as checkout at the quoted prices. | One money path; special orders (an LVL beam) are quotable. | Staff need a quote builder (in scope). |
| D17 | Ids for client-retried writes are client-generated UUIDv4s used as document ids (`orders/{checkoutId}`, `quotes/{requestId}`, `issues/{issueId}`). A retry returns the existing result; an id owned by someone else returns a generic `already-exists`. Card authorization uses the same id as its idempotency key. | Lost responses never create a second order or charge. | Clients must generate and keep the id across retries (one helper). |
| D18 | The cart stays on the device for everyone in P0 (`instasupply.cart.v2`, lines carry `storeId`). `carts/{uid}` is specified and rule-protected now; syncing it is **P1**. | Smallest P0; the server re-prices anyway. | No cross-device cart this week. |

**Conflicts resolved from the proposals.** Pricing thresholds are order-level and uncapped (D5,
not per-store/capped). Coupling is in transactions, not triggers (D7). The supplier PIN covers
driver collections too (D8). City + vehicle audience matching is enforced in rules (D9). Driver
chat is untouched (D11). Emulator region is unchanged (D13). Time handling has no `Intl` (D14). The
25 tiles are the taxonomy (D15). Driver vehicle changes need staff review (`vehicleDraft`, §5.4).
Each store order owns its own PIN (not one code per order). Supplier payouts never precede the
customer charge (§3.9); driver pay follows the delivery, as the driver site promises. Driver
onboarding takes attestations only; no licence or insurance images are stored (PIPEDA).

---

## 1. Domain model

### 1.1 Conventions

- **Money:** integer CAD cents, field names end in `Cents`, validated with `Number.isSafeInteger`
  and `>= 0` unless a field is documented as signed (ledger amounts). Never floats in Firestore.
- **Units:** weight `weightKg` (≤ 3 decimals) per sell unit; size `dimsCm: { l, w, h }` per sell
  unit in cm (≤ 1 decimal, `l` = longest side). Trade sizes go in `size` text ("2 in × 4 in × 8 ft").
- **Distance:** road distance is computed in integer **tenths of a km** (`roadTenths`) and stored as
  `roadKm` (1 decimal). See §3.1.
- **Time:** instants are Firestore `Timestamp` fields ending in `At` (UTC). Business dates are
  `YYYY-MM-DD` strings and clock times `HH:MM` strings, **always America/Toronto**. Arrays of maps
  use `Timestamp.now()` (no `serverTimestamp()` inside arrays).
- **Phones:** E.164 NANP `+1NXXNXXXXXX`, shown `(416) 555-0110`. **Postal codes:** `A1A 1A1`,
  Ontario forward sortation areas start with K, L, M, N or P.
- **Market:** one market, `marketId: 'gta'`, with 15 cities (§1.5). Stores carry `marketId` and
  `cityId`; drivers carry `cityId`.
- **Writers:** "functions" means the Admin SDK. Anything not explicitly client-writable in §6 is
  server-only. Every document has `createdAt` and `updatedAt`.

**Document ids**

| Document | Id |
| --- | --- |
| `orders` | client `checkoutId` (UUIDv4; `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`) |
| `storeOrders` | `{orderId}-{letter}`; letters `A`–`E` assigned in ascending `storeId` order |
| `deliveries` | automatic |
| `jobOffers` | the `deliveryId` |
| `products` | `{storeId}--{skuSlug}` (`skuSlug` = SKU lower-cased, runs of non `[a-z0-9]` → `-`) |
| `stores` | slug, e.g. `kestrel-lumber` (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3–40 chars: never contains `--`, which separates the product id) |
| `quotes` | client `requestId` (UUIDv4) |
| `issues` | client `issueId` (UUIDv4) |
| `stores/{storeId}/reviews` | the `storeOrderId` |
| `ledgerEntries` | deterministic, §3.9 (`sale_{storeOrderId}`, `delivery_{deliveryId}_{attempt}` …) |
| `payouts` | `{payeeType}_{payeeId}_{runKey}`, `runKey` = `YYYYMMDD-HHMM` of the run cutoff in Toronto |
| `supportThreads` | the customer's uid, or `store_{storeId}` |
| `counters` | `deliveries` (shared by orders and manual deliveries), `quotes`, `issues` |
| `rateLimits` | `{bucket}_{subject}`, e.g. `geocode_{uid}`, `suggest_{hmac(ip)}` (HMAC-SHA256 of the caller IP keyed with `OTP_PEPPER`; no raw IPs are stored) |

**Human numbers**

| Thing | Format | Source |
| --- | --- | --- |
| Order | `IS-10042` | `counters/deliveries` (existing `peekOrderIdInTx`, generalized to `peekSequenceInTx`) |
| Store order, and its delivery's `orderId` field | `IS-10042-A` | order number + letter |
| Manual delivery | `IS-10043` | same counter (unchanged) |
| Quote | `Q-10001` | `counters/quotes` |
| Issue | `CASE-10001` | `counters/issues` |

### 1.2 Collection map

| Path | Purpose | Written by | Read by |
| --- | --- | --- | --- |
| `users/{uid}` | profile for every role | functions; the user edits `displayName, photoURL, preferences, companyName, accountType` | the user, staff; a store **owner** lists their store's supplier users |
| `users/{uid}/jobsites/{jobsiteId}` | saved jobsites (replaces `addresses`) | the customer (rules-validated) | the customer |
| `users/{uid}/cards/{cardId}` | test cards: brand, last 4, expiry only | the user (validated) | the user |
| `users/{uid}/favorites/{productId}` | saved materials | the user | the user |
| `users/{uid}/devices/{installationId}` | push tokens (unchanged) | the user | the user |
| `carts/{uid}` | **P1** signed-in cart | the customer (validated) | the customer |
| `categories/{categoryId}` | 25 tiles + shipping defaults | staff | public |
| `stores/{storeId}` | storefront, hours, fulfilment, status, rating | functions (`createStore`, `updateStoreSettings`, `updateStoreProfile`, rating trigger) | public |
| `stores/{storeId}/private/settings` | commission, payout account, alert phone, loading notes, onboarding checklist | functions | staff, the store owner |
| `stores/{storeId}/reviews/{storeOrderId}` | one rating per completed store order | the customer (rules-validated) | public |
| `products/{productId}` | one store listing | staff; members of the product's store (validated, locked fields §6); functions for server fields | public |
| `orders/{orderId}` | checkout receipt, payment, store-order summaries, derived status | functions | the customer, staff |
| `storeOrders/{storeOrderId}` | one store's part of an order | functions | the customer (`get`), members of its store, staff |
| `storeOrders/{storeOrderId}/private/meta` | pickup PIN, PIN attempts, commission rate | functions | staff |
| `deliveries/{deliveryId}` (+ `events`, `private/meta`) | one trip store → jobsite (or a manual delivery) | functions; staff edit contact, notes, window, `unload` | staff, the assigned driver |
| `jobOffers/{deliveryId}` | PII-free job-board card | functions | staff; active drivers whose claim matches `audience` while `status == 'open'` |
| `tracking/{token}` | public tracking view (extended) | functions | anyone with the token (`get` only) |
| `routes/{driverId}`, `driverLocations/{uid}` | unchanged (route stops gain `kind`) | unchanged | unchanged |
| `threads/{driverId}` (+ `messages`) | dispatch ↔ driver chat, **unchanged** | unchanged | unchanged |
| `supportThreads/{threadId}` (+ `messages`) | customer/store ↔ InstaSupply chat | functions (summary); participants and staff (messages) | the owner (customer or store members), staff |
| `quotes/{quoteId}` | material list + latest sent offer | functions; staff move `status` submitted → in_review and set the assignee | the customer, staff |
| `quotes/{quoteId}/private/workspace` | quote-builder draft, internal note | staff | staff |
| `issues/{issueId}` | problem report + resolution | functions; staff move open → in_review and set the assignee | the customer, members of its store, staff |
| `issues/{issueId}/private/notes` | internal notes | staff | staff |
| `ledgerEntries/{entryId}` | signed money movements per payee | functions | staff; the store owner (own store); the driver (own) |
| `payouts/{payoutId}` | daily batches per payee | functions | same as ledger entries |
| `storeSuggestions/{id}` | "Suggest a store" | functions (`suggestStore`); staff change `status` | staff |
| `notifications/{id}` | inbox (new types §5.8) | functions; recipient marks read | recipient |
| `counters/*`, `otpChallenges/*`, `rateLimits/*` (TTL `expiresAt`) | server only | functions | nobody |
| `devOutbox/*` | dev SMS outbox (unchanged) | functions | staff |

**Removed:** `users/{uid}/addresses`, `products/{productId}/reviews`.

### 1.3 Shared types (`packages/shared/src`)

File layout (A owns all of it): `market.ts`, `money.ts`, `catalog.ts`, `vehicles.ts`,
`pricing.ts`, `time-zone.ts`, `fulfilment-time.ts`, `marketplace.ts`, `jobs.ts`, `quotes.ts`,
`issues.ts`, `support.ts`, `payouts.ts`, `cards.ts`, `errors.ts`, plus the existing `types.ts`,
`status.ts`, `constants.ts`, `validation.ts`, `format.ts`, `geo.ts`, `route-optimizer.ts`,
`polyline.ts`, `api.ts`. `commerce.ts` is deleted (its content is split across `catalog.ts`,
`cards.ts`, `pricing.ts` and `marketplace.ts`).

```ts
// ---------- market.ts ----------
export const MARKET_ID = 'gta' as const;
export type MarketId = typeof MARKET_ID;
export const MARKET_TIME_ZONE = 'America/Toronto';
export const CURRENCY = 'CAD' as const;
export const TAX = { label: 'HST', rateBps: 1300 } as const;           // Ontario
export type CityId = 'toronto' | 'mississauga' | 'brampton' | 'vaughan' | 'markham' | 'richmond_hill'
  | 'oakville' | 'burlington' | 'milton' | 'pickering' | 'ajax' | 'whitby' | 'oshawa' | 'newmarket' | 'aurora';
export const CITIES: Record<CityId, { name: string; center: LatLng; anchors: LatLng[] }>;   // §1.5
export const SERVICE_AREA = { south: 43.25, west: -80.0, north: 44.15, east: -78.75 };  // jobsite pins must be inside
export const ONTARIO_HOLIDAYS: readonly string[];                         // §4.2; no fulfilment on these dates
export const SUPPORT_HOURS: Record<Weekday, DayHours | null>;            // Mon–Fri 07:00–18:00, Sat 08:00–14:00
export function nearestCity(point: LatLng): CityId;                     // nearest center or anchor; approximate near borders

// ---------- types.ts (changed parts) ----------
export type Role = 'admin' | 'dispatcher' | 'driver' | 'customer' | 'supplier';
export type StoreRole = 'owner' | 'staff';
export type ActorRole = Role | 'system';                                  // 'customer' already in Role
export interface AuthClaims { role?: Role; active?: boolean;
  storeId?: string; storeRole?: StoreRole;                                // suppliers
  cityId?: CityId; capacityClass?: VehicleClass }                         // approved drivers
export type AccountType = 'contractor' | 'renovator' | 'builder' | 'homeowner';
export interface UserPreferences { chatPush?: boolean; deliveryPush?: boolean; orderPush?: boolean;
  promoPush?: boolean /* default false: CASL opt-in */; jobPush?: boolean; storeOrderPush?: boolean }
export interface UserProfile {
  uid: string; role: Role; status: AccountStatus; displayName: string; email: string | null;
  phoneNumber: string | null; phoneVerified: boolean; photoURL?: string | null; preferences?: UserPreferences;
  // customer
  companyName?: string | null; accountType?: AccountType | null;   // defaults: `isDefault` on the jobsite and card docs
  stats?: { nonCancelledOrders: number; completedOrders: number; lastOrderAt: TimestampLike | null }; // server-only
  promoUses?: Record<string, number>;                                     // server-only
  // supplier (copies of the claims)
  storeId?: string | null; storeRole?: StoreRole | null;
  // driver
  cityId?: CityId | null; vehicle?: DriverVehicle | null;                 // approved vehicle, server-only
  payoutAccount?: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null;  // server-only, set by ops
  vehicleDraft?: DriverVehicle | null; vehicleReviewRequired?: boolean;   // pending change, server-only
  compliance?: { licenceAttestedAt: TimestampLike; insuranceAttestedAt: TimestampLike; termsAcceptedAt: TimestampLike;
    licenceVerified: boolean; insuranceVerified: boolean; verifiedBy: string | null; verifiedAt: TimestampLike | null } | null;
  driverStats?: { deliveries: number; earnedCents: number };             // server-only, recordDeliveryLedger
  suspendedReason?: string | null; approvedBy?: string | null; approvedAt?: TimestampLike | null;
  createdAt?: TimestampLike; updatedAt?: TimestampLike;
}
// Removed: `Vehicle` (replaced by DriverVehicle), VehicleType 'bike' | 'scooter' | 'van' | 'truck'.

// ---------- vehicles.ts ----------
export type VehicleClass = 'car' | 'suv' | 'pickup' | 'cargo_van' | 'box_truck' | 'flatbed'; // required/capable class
export type VehicleType = 'car' | 'suv' | 'pickup' | 'cargo_van' | 'box_truck' | 'flatbed' | 'dump_truck' | 'other'; // declared
export type VehicleExtra = 'trailer' | 'roof_rack' | 'liftgate' | 'ramps_dolly';
export interface DriverVehicle { type: VehicleType; make: string; model: string; year: number; plate: string;
  colour: string | null; boxLengthFt: 5.5 | 6.5 | 8 | null /* pickups */; payloadKg: number | null;
  extras: VehicleExtra[]; capacityClass: VehicleClass /* set by server or staff */ }
export interface LoadLine { name: string; quantity: number; unit: SellUnit; size: string | null; weightKg: number; longestCm: number }
export interface LoadSummary { pieces: number; weightG: number; weightKg: number /* 1 dp */; longestCm: number;
  volumeL: number; hasSheets: boolean; handlingPieces: number; heaviestUnitKg: number; heavy: boolean;
  vehicleClass: VehicleClass | null /* null = too large for one delivery */; summary: string; lines: LoadLine[] /* ≤ 60 */ }
export interface DriverPayout { offerCents: number; baseCents: number; distanceCents: number; loadCents: number;
  handlingCents: number; boostCents: number; waitCents: number; totalCents: number }

// ---------- catalog.ts ----------
export type CategoryId = 'adhesives' | 'fasteners' | 'tools' | 'safety' | 'wood' | 'drywall' | 'insulation'
  | 'masonry' | 'roofing' | 'electrical' | 'plumbing' | 'hvac' | 'doors' | 'windows' | 'glass' | 'hardware'
  | 'paint' | 'flooring' | 'wall-decor' | 'cleaning' | 'storage' | 'bath' | 'kitchen' | 'appliances' | 'outdoors';
export const CATEGORY_IDS: readonly CategoryId[];                       // in this order (= sortOrder)
export interface DimsCm { l: number; w: number; h: number }
export interface Category { id: CategoryId; name: string; iconKey: string /* 'cat-<id>' */; tint: string; accent: string;
  sortOrder: number; defaultWeightKg: number; defaultDimsCm: DimsCm; synonyms: string[]; active: boolean }
export type SellUnit = 'each' | 'pair' | 'sheet' | 'length' | 'bundle' | 'box' | 'bag' | 'pail' | 'can'
  | 'tube' | 'roll' | 'pack' | 'kit';
export type ProductBadge = 'new' | 'bestseller' | 'deal';
export interface Product {
  id: string; storeId: string; sku: string; name: string; brand: string | null; categoryId: CategoryId;
  familyKey: string | null;                         // staff only
  unit: SellUnit; size: string | null; description: string;
  priceCents: number; compareAtCents: number | null;
  stockOnHand: number;                              // supplier
  reserved: number;                                 // server only
  maxPerOrder: number | null;
  weightKg: number; dimsCm: DimsCm; shipEstimated: boolean;   // true when filled from category defaults
  active: boolean; featured: boolean /* staff */; badge: ProductBadge | null /* staff */;
  imageKey: string | null; imagePath: string | null /* 'productPhotos/{storeId}/…' */;
  imageUrl: string | null;                          // server only: download URL of imagePath (§5.6)
  listed: boolean; storeName: string; storeStatus: StoreStatus; searchTerms: string[];   // server only
  createdAt: TimestampLike; updatedAt: TimestampLike; updatedBy: string;
}
export const availableQty = (p: Pick<Product, 'stockOnHand' | 'reserved'>) => Math.max(0, p.stockOnHand - p.reserved);
export const LOW_STOCK_THRESHOLD = 10;            // "Only 4 left" below this

export type StoreStatus = 'onboarding' | 'coming_soon' | 'live' | 'closed';
export type StoreSpecialty = 'lumber_building' | 'drywall_paint' | 'electrical' | 'plumbing' | 'hvac_refrigeration'
  | 'fasteners_hardware' | 'glass_mirrors' | 'doors_trims' | 'kitchen_cabinets' | 'bath_fixtures'
  | 'designer_lighting' | 'insulation_soundproofing' | 'masonry_roofing';
export const STORE_SPECIALTY_LABELS: Record<StoreSpecialty, string>;   // §1.5, the site's wording
export const STORE_SPECIALTY_ART: Record<StoreSpecialty, string>;      // store-* art key, §12.7
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface DayHours { open: string; close: string }             // 'HH:MM', close > open, no overnight
export interface PostalAddress { line1: string; line2: string | null; city: string; province: 'ON'; postalCode: string | null }
export interface Store {
  id: string; name: string; specialty: StoreSpecialty; categoryIds: CategoryId[]; description: string;
  marketId: MarketId; cityId: CityId; areaLabel: string /* 'Etobicoke' */; address: PostalAddress; location: LatLng;
  phone: string; email: string | null;
  photoUrl: string | null /* server-set from a storePhotos/{storeId}/ upload */; imageKey: string | null /* store-* art, §12.7 */;
  hours: Record<Weekday, DayHours | null>; closures: string[] /* YYYY-MM-DD, ≤ 60 */;
  fulfilment: { delivery: boolean; pickup: boolean; deliveryRadiusKm: number /* 1–60, staff only */ };
  prepMinutes: number /* 5–240 */; sameDayCutoff: string /* 'HH:MM' */;   // loading notes are private (gate codes)
  status: StoreStatus /* admin */; acceptingOrders: boolean /* "Pause new orders" */;
  rating: number; ratingCount: number;                                  // trigger
  createdAt: TimestampLike; updatedAt: TimestampLike;
}
export interface StorePrivateSettings { commissionBps: number /* default 1000 */;
  payoutAccount: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null;
  ordersEmail: string | null; alertPhone: string | null /* NANP mobile for new-order and reminder SMS */;
  loadingNotes: string | null /* copied into deliveries for the driver; never public */;
  onboarding: { catalogReady: boolean; payoutsReady: boolean; trained: boolean }; notes: string | null }
export interface StoreReview { storeId: string; storeOrderId: string; customerId: string; authorName: string /* 'Dana W.' */;
  rating: number /* 1–5 int */; text: string /* ≤ 1000 */; createdAt: TimestampLike; updatedAt: TimestampLike }
export function buildSearchTerms(name: string, extra: readonly string[]): string[];   // §5.6 onProductWritten
export function searchKeyFor(text: string): string | null;
export const SEARCH_SYNONYMS: Record<string, string[]>;                // §1.5 category synonyms + site names
export const SUGGEST_STORE_INTERESTS: readonly string[];               // the site's 24 names, §1.5

// ---------- marketplace.ts ----------
export type Fulfilment = 'delivery' | 'pickup';
export type Receiving = 'attended' | 'unattended';   // attended: someone receives, hand-off code; unattended: photo drop
export interface Contact { name: string; phone: string }
export interface JobsiteFields extends PostalAddress {
  label: string /* 'Leslieville semi reno' */; location: LatLng /* required: "drop a pin" */;
  cityId: CityId; areaLabel: string /* 'Leslieville · M4M' */; contactName: string; contactPhone: string;
  instructions: string | null /* gate code, where to stack */; receiving: Receiving;
  maxVehicleClass: VehicleClass | null /* "narrow lane: cargo van max" */ }
export interface Jobsite extends JobsiteFields { id: string; isDefault: boolean; lastUsedAt: TimestampLike | null;
  createdAt: TimestampLike; updatedAt: TimestampLike }
export type JobsiteSnapshot = JobsiteFields & { jobsiteId: string | null; addressLine: string };
export interface CartLine { productId: string; storeId: string; quantity: number }       // device cart
export interface Cart { lines: CartLine[]; promoCode: string | null; unloadHelpStoreIds: string[]; fulfilment: Fulfilment;
  jobsiteId: string | null; updatedAt: TimestampLike }                                    // carts/{uid}, P1 (same shape as the device cart)

export interface DeliveryWindow { id: string /* 'asap' | '2026-11-20T07:00' */; kind: 'asap' | 'scheduled';
  date: string; startAt: TimestampLike | null; endAt: TimestampLike /* deliver by */; label: string /* 'Today by 1:50 pm' */ }
export interface Amounts { itemsCents: number; discountCents: number; deliveryFeeCents: number;
  unloadFeeCents: number; taxCents: number; totalCents: number }
export interface AppliedDiscount { kind: 'first_order' | 'promo'; code: string | null; label: string; cents: number }

export type OrderStatus = 'placed' | 'confirmed' | 'preparing' | 'ready' | 'on_the_way' | 'completed' | 'cancelled';
export type PaymentStatus = 'authorized' | 'capture_pending' | 'captured' | 'capture_failed'
  | 'partially_refunded' | 'refunded' | 'voided' | 'not_required';
export interface PaymentEvent { type: 'authorize' | 'void' | 'capture' | 'capture_failed' | 'release' | 'refund';
  amountCents: number; storeOrderId: string | null; issueId: string | null; ref: string; idempotencyKey: string;
  reason: string | null; at: TimestampLike }
export interface OrderPayment { method: 'card' | 'none'; provider: 'test' | 'stripe'; intentRef: string | null;
  card: { cardId: string; brand: CardBrand; last4: string } | null; status: PaymentStatus;
  authorizedCents: number; capturedCents: number; refundedCents: number; pendingCaptureCents: number;
  capturedByStoreOrder: Record<string, number> /* each store order's current.totalCents at capture */;
  refundedByStoreOrder: Record<string, number> /* issue refunds */; adjustedByStoreOrder: Record<string, number> /* refund_adj_… */;
  authorizedAt: TimestampLike | null;
  captureDeadlineAt: TimestampLike | null /* min(authorizedAt + 6 days, gateway captureBefore − 6 h) */; capturedAt: TimestampLike | null;
  events: PaymentEvent[] /* ≤ 30 */ }
export interface StoreOrderSummary { storeOrderId: string; number: string; letter: string; storeId: string;
  storeName: string; fulfilment: Fulfilment; status: StoreOrderStatus; itemCount: number; itemsSummary: string;
  currentTotalCents: number; deliverBy: TimestampLike | null; readyAt: TimestampLike | null;
  holdUntil: TimestampLike | null; trackingToken: string | null;
  pickupCode: string | null /* pickup fulfilment only; the customer shows it at the counter */;
  driverFirstName: string | null; updatedAt: TimestampLike }
export interface Order {
  id: string; number: string; source: 'cart' | 'quote' | 'replacement'; quoteId: string | null; issueId: string | null;
  customerId: string; customerName: string; companyName: string | null; customerPhone: string;
  fulfilment: Fulfilment; jobsite: JobsiteSnapshot | null; receiving: Receiving | null; siteContact: Contact | null;
  window: DeliveryWindow | null; instructions: string | null;
  storeOrderIds: string[]; storeCount: number; lineCount: number; itemCount: number; itemsSummary: string;
  placed: Amounts & { discounts: AppliedDiscount[]; promoCode: string | null;
    freeDelivery: 'first_order' | 'free_threshold' | null };         // immutable checkout receipt
  current: Amounts;                                                    // projection: Σ store orders' current
  payment: OrderPayment;
  storeOrders: StoreOrderSummary[];                                    // projection (onStoreOrderWritten)
  status: OrderStatus; statusAt: Partial<Record<OrderStatus, TimestampLike>>; needsAttention: boolean;
  isFirstOrder: boolean; countsTowardFirstOrder: boolean;
  hstNumber: string | null;                                            // HST registration on the receipt (HST_NUMBER at placement)
  cancelReason: string | null; completedAt: TimestampLike | null; createdAt: TimestampLike; updatedAt: TimestampLike;
}

export type StoreOrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered'
  | 'picked_up' | 'failed' | 'rejected' | 'cancelled';
export type StoreRejectReason = 'out_of_stock' | 'cannot_meet_time' | 'store_closed' | 'pricing_error'
  | 'cannot_deliver_to_site' | 'no_response' | 'other';
export type ShortReason = 'out_of_stock' | 'damaged' | 'discontinued' | 'other';
export type DriverPhase = 'assigned' | 'to_store' | 'at_store' | 'loaded' | 'to_site' | 'at_site' | 'delivered' | 'problem';
export interface StoreOrderLine {
  lineId: string /* 'L1'… */; kind: 'catalog' | 'custom'; productId: string | null; sku: string | null;
  name: string; brand: string | null; unit: SellUnit; size: string | null; categoryId: CategoryId | null;
  imageKey: string | null; imageUrl: string | null; unitPriceCents: number; quantity: number /* ordered */;
  fulfilledQty: number /* = quantity until shorted; only ever lowered */; shortReason: ShortReason | null;
  lineCents: number /* unitPriceCents × quantity, placed */; discountCents: number /* allocated at placement */;
  weightKg: number; dimsCm: DimsCm; note: string | null }
export interface StoreOrderHistoryEntry { status: StoreOrderStatus; at: TimestampLike; actorId: string | null;
  actorName: string | null; actorRole: ActorRole; note: string | null }
export interface StoreOrder {
  id: string; number: string; letter: string; orderId: string; orderNumber: string; source: Order['source'];
  storeId: string; storeName: string; storeAddressLine: string; storeLocation: LatLng; storePhone: string;
  customerId: string; customerName: string; companyName: string | null; customerPhone: string;
  fulfilment: Fulfilment; jobsite: JobsiteSnapshot | null; receiving: Receiving | null; siteContact: Contact | null;
  instructions: string | null; window: DeliveryWindow | null;
  timing: { respondBy: TimestampLike; readyBy: TimestampLike; readyByDate: string /* local, for "today" boards */;
    targetPickupAt: TimestampLike | null; deliverBy: TimestampLike | null };
  lines: StoreOrderLine[]; lineCount: number; itemCount: number; itemsSummary: string;
  load: LoadSummary; vehicleClass: VehicleClass | null; roadKm: number | null;
  unload: { offered: boolean; required: boolean; selected: boolean; feeCents: number };
  deliveryFeeListCents: number; feeWaiver: 'first_order' | 'free_threshold' | 'replacement' | null;
  placed: Amounts; current: Amounts;                                   // current ≤ placed, always
  storeValueCents: number /* Σ store price × fulfilledQty; = current.itemsCents except replacements */;
  status: StoreOrderStatus; statusAt: Partial<Record<StoreOrderStatus, TimestampLike>>;
  version: number /* +1 on every status change or adjustment */; history: StoreOrderHistoryEntry[] /* ≤ 40 */;
  deliveryId: string | null;
  driver: { firstName: string; vehicleLabel: string; plate: string; phase: DriverPhase;
    arrivedAt: TimestampLike | null; etaToStoreAt: TimestampLike | null } | null;          // projection
  driverSyncedAt: TimestampLike | null;  // delivery updatedAt of the last projection; kept when driver is null (monotonic)
  pickup: { readyAt: TimestampLike | null; holdUntil: TimestampLike | null; collectedAt: TimestampLike | null;
    collectedBy: 'customer' | 'driver' | null };                     // PIN and attempts live in private/meta
  rejectReason: StoreRejectReason | null; cancelReason: string | null;
  cancelledBy: 'customer' | 'store' | 'staff' | 'system' | null;
  reminderSentAt: TimestampLike | null; acceptOverdue: boolean; issueCount: number; rated: boolean;
  completedAt: TimestampLike | null; createdAt: TimestampLike; updatedAt: TimestampLike;
}
export interface StoreOrderPrivateMeta { pickupCode: string | null /* 4 digits; delivery: null until a driver claims or is assigned */;
  pickupCodeIssuedTo: 'customer' | string /* driver uid */ | null; codeAttempts: number; commissionBps: number;
  alertSmsSentAt: TimestampLike | null /* new-order SMS sent once */ }

// ---------- types.ts: Delivery additions (removed: codAmount, proof.codCollected) ----------
export interface DeliveryMarketplaceFields {
  kind: 'marketplace' | 'manual';
  storeOrderId: string | null; storeId: string | null;               // existing sourceOrderId = order id, customerId = customer
  pickup: { storeId: string; storeName: string; address: string; location: LatLng; phone: string;
    loadingNotes: string | null; readyBy: TimestampLike; ready: boolean; readyAt: TimestampLike | null;
    arrivedAt: TimestampLike | null; collectedAt: TimestampLike | null; pickupCode: string | null /* assigned driver only */ } | null;
  load: LoadSummary | null; vehicleClass: VehicleClass | null; tripKm: number | null; cityIds: CityId[];
  receiving: Receiving | null; requirePhoto: boolean;                // marketplace: true; requireCode = receiving === 'attended'
  unload: { labourer: boolean; required: boolean; status: 'not_needed' | 'needed' | 'booked';
    labourerName: string | null; labourerPhone: string | null } | null;
  payout: DriverPayout | null;
  offerStatus: 'held' | 'scheduled' | 'open' | 'claimed' | 'withdrawn' | null /* manual */; offerOpensAt: TimestampLike | null; // §2.4
  releasedBy: Record<string, TimestampLike>;                         // uid → when they released this job
}
// customer = site contact; address/location = jobsite; addressNotes = jobsite instructions + checkout instructions;
// windowStart/windowEnd = scheduled window (ASAP: null / deliverBy); priority = 'high' for ASAP, 'normal' otherwise.
export type TrackingPhase = 'finding_driver' | 'driver_assigned' | 'to_store' | 'at_store' | 'loaded' | 'to_site'
  | 'at_site' | 'delivered' | 'problem' | 'cancelled';
// PublicTracking gains: kind, phase, storeOrderNumber | null, pickup { storeName, location } | null,
//   deliverBy | null, windowLabel | null, receiving | null, unloadNote | null.
// RouteStop gains: kind: 'pickup' | 'dropoff'; title: string (store name or site contact). A delivery can now have two
//   stops with the same deliveryId (pickup + drop-off); see §5.11.
// DevOutboxMessage.purpose gains 'store_alert' (new-order and reminder SMS to the store's alertPhone).

// ---------- jobs.ts ----------
export interface JobOffer {
  deliveryId: string; storeOrderNumber: string; status: 'scheduled' | 'open';
  audience: string[] /* `${cityId}:${capacityClass}` */; cityIds: CityId[];
  vehicleClass: VehicleClass; vehicleClassRank: number; opensAt: TimestampLike; openedAt: TimestampLike | null;
  pickup: { storeName: string; areaLabel: string; location: LatLng; readyBy: TimestampLike; ready: boolean };
  dropoff: { areaLabel: string; approxLocation: LatLng /* rounded to 2 decimals */ };
  tripKm: number; window: { kind: 'asap' | 'scheduled'; startAt: TimestampLike | null; endAt: TimestampLike; label: string };
  load: { summary: string; pieces: number; weightKg: number; longestCm: number; hasSheets: boolean; heavy: boolean;
    lines: { name: string; quantity: number; unit: SellUnit }[] /* first 5 */ };
  unload: 'driver' | 'site_crew' | 'labourer';                          // labourer if selected; attended → site_crew; else driver
  payoutCents: number; payoutBreakdown: Omit<DriverPayout, 'offerCents' | 'waitCents' | 'totalCents'>;
  nudgedAt: TimestampLike | null; createdAt: TimestampLike; updatedAt: TimestampLike;
}
export const MAX_ACTIVE_JOBS_PER_DRIVER = 4;
export function audienceFor(cityIds: readonly CityId[], jobClass: VehicleClass, siteMax: VehicleClass | null): string[];

// ---------- quotes.ts ----------
export type QuoteStatus = 'submitted' | 'in_review' | 'quoted' | 'accepted' | 'declined' | 'expired' | 'cancelled';
export interface QuoteAttachment { path: string; name: string; contentType: string; sizeBytes: number }
export interface QuoteRequest { lines: { text: string; quantity: number | null }[]; attachments: QuoteAttachment[];
  neededBy: { kind: 'asap' | 'this_week' | 'date'; date: string | null }; fulfilment: Fulfilment;
  jobsite: JobsiteSnapshot | null; contact: { preferred: 'call' | 'whatsapp' | 'email'; phone: string | null; email: string | null };
  notes: string | null }
export interface QuoteLine { lineId: string; kind: 'catalog' | 'custom'; productId: string | null; storeId: string;
  storeName: string; sku: string | null; name: string; brand: string | null; unit: SellUnit; size: string | null;
  quantity: number; listPriceCents: number | null; unitPriceCents: number; weightKg: number; dimsCm: DimsCm;
  note: string | null; requestLine: number | null }
export interface QuoteOffer { version: number; lines: QuoteLine[]; unmatched: { requestLine: number; text: string; reason: string }[];
  fulfilment: Fulfilment; receiving: Receiving | null; windowId: string | null; windowLabel: string | null;
  unloadHelpStoreIds: string[]; pricing: PricedCheckout /* snapshot at send */; message: string | null;
  validUntil: TimestampLike; sentBy: string; sentByName: string; sentAt: TimestampLike }
export interface Quote { id: string; number: string; customerId: string; customerName: string; companyName: string | null;
  customerPhone: string | null; customerEmail: string | null; request: QuoteRequest; status: QuoteStatus;
  statusAt: Partial<Record<QuoteStatus, TimestampLike>>; respondBy: TimestampLike; assignedTo: string | null;
  assignedName: string | null; offer: QuoteOffer | null; offerValidUntil: TimestampLike | null;
  offerHistory: { version: number; totalCents: number; sentAt: TimestampLike }[]; orderId: string | null;
  closeReason: string | null; createdAt: TimestampLike; updatedAt: TimestampLike }

// ---------- issues.ts ----------
export type IssueType = 'damaged' | 'wrong_item' | 'missing_item' | 'short_quantity' | 'late' | 'other';
export type IssueStatus = 'open' | 'in_review' | 'resolved';
export type FaultParty = 'store' | 'driver' | 'platform' | 'customer';
export interface Issue { id: string; number: string; customerId: string; customerName: string; orderId: string;
  orderNumber: string; storeOrderId: string; storeOrderNumber: string; storeId: string; storeName: string;
  deliveryId: string | null; driverId: string | null; type: IssueType;
  lines: { lineId: string; name: string; quantity: number; unitPriceCents: number }[]; description: string;
  photoPaths: string[]; preferredResolution: 'replacement' | 'refund' | 'return'; status: IssueStatus;
  statusAt: Partial<Record<IssueStatus, TimestampLike>>; slaDueAt: TimestampLike; assignedTo: string | null;
  assignedName: string | null;
  resolution: { kind: 'refund' | 'replacement' | 'no_action'; refundCents: number; refundItemsCents: number;
    refundDeliveryFee: boolean; returnRequired: boolean; faultParty: FaultParty | null;
    replacementOrderId: string | null; note: string; resolvedBy: string; resolvedByName: string; resolvedAt: TimestampLike } | null;
  completedAt: TimestampLike; createdAt: TimestampLike; updatedAt: TimestampLike }
export const ISSUE_WINDOW_HOURS = 48;

// ---------- support.ts ----------
export type SupportThreadKind = 'customer' | 'store';
export interface SupportContext { kind: 'order' | 'store_order' | 'quote' | 'issue'; id: string; label: string }
export interface SupportThread { kind: SupportThreadKind; ownerId: string /* uid or storeId */; ownerName: string;
  companyName: string | null; status: 'open' | 'resolved'; assignedTo: string | null; assignedName: string | null;
  context: SupportContext | null; lastMessage: { text: string; senderRole: SupportSenderRole; at: TimestampLike } | null;
  unreadByOwner: number; unreadByStaff: number; ownerReadAt: TimestampLike | null; staffReadAt: TimestampLike | null;
  createdAt: TimestampLike; updatedAt: TimestampLike }
export type SupportSenderRole = 'customer' | 'supplier' | 'staff';
export interface SupportMessage { id: string; text: string; senderId: string; senderName: string;
  senderRole: SupportSenderRole; context: SupportContext | null; createdAt: TimestampLike }

// ---------- payouts.ts ----------
export type LedgerKind = 'sale' | 'commission' | 'delivery' | 'failed_attempt' | 'cancellation' | 'clawback' | 'adjustment';
export interface LedgerEntry { payeeType: 'store' | 'driver'; payeeId: string; kind: LedgerKind; amountCents: number /* signed */;
  orderId: string | null; storeOrderId: string | null; deliveryId: string | null; issueId: string | null;
  description: string; payoutId: string | null; heldForIssueId: string | null /* skipped by payouts while set */;
  createdAt: TimestampLike }
export interface Payout { payeeType: 'store' | 'driver'; payeeId: string; payeeName: string; runKey: string; periodDate: string;
  entryIds: string[]; entryCount: number; creditsCents: number; debitsCents: number; netCents: number;
  status: 'pending' | 'paid' | 'failed' /* pending until the transfer returns */; provider: 'test' | 'stripe';
  reference: string | null; createdAt: TimestampLike; paidAt: TimestampLike | null }
export interface StoreSuggestion { storeName: string; city: string; interests: string[]; email: string | null;
  suggestedBy: string | null; source: 'app' | 'web'; status: 'new' | 'contacted' | 'onboarding' | 'dismissed';
  createdAt: TimestampLike; updatedAt: TimestampLike }

// ---------- cards.ts (moved from commerce.ts) ----------
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'card';   // 'rupay' removed
// detectCardBrand (adds Discover: ^6(011|5|4[4-9])), isValidCardNumber (Luhn), isFutureExpiry, SavedCard (unchanged shape)
```

### 1.4 What is copied on purpose (denormalized) and who keeps it fresh

| Copy | Lives in | Kept fresh by | Why |
| --- | --- | --- | --- |
| `listed, storeName, storeStatus, searchTerms` (+ `imageUrl` derived from `imagePath`) | `products` | `onProductWritten`, `onStoreWritten` (fan-out) | One-collection search and listing; non-live stores disappear at query time; clients never type a URL. |
| Line snapshots (name, price, weight, size), jobsite snapshot, customer contact | `storeOrders` | immutable at checkout | History never changes when a catalogue item or jobsite is edited; suppliers never read `orders`, `users` or `deliveries`. |
| `storeOrders[]` summaries, `current`, `status`, `needsAttention` | `orders` | `syncOrderAggregate` (single writer) | Home, history and detail screens read one document. Tracking tokens and the customer pickup PIN stay out of supplier-readable documents. |
| `driver { firstName, vehicleLabel, plate, phase, arrivedAt, etaToStoreAt }` | `storeOrders` | `projectDriverOntoStoreOrder` from `onDeliveryWritten`, monotonic on `driverSyncedAt` | Suppliers see who is coming without reading deliveries. |
| `pickup` block (incl. the store's private loading notes), `load`, `payout`, `vehicleClass`, site contact | `deliveries` | immutable at creation (boost and wait are additive) | The driver app and route planner read only deliveries; pay shown up front never drifts. |
| Everything a driver needs to decide, minus PII | `jobOffers` | the callables that change `offerStatus` (§2.4) | City-wide board without exposing customers. |
| `pickup { storeName, location }`, `phase`, `deliverBy` | `tracking` | `syncTracking` | The public page can say "Heading to Kestrel Lumber Yard". |
| `commissionBps`, pickup PIN | `storeOrders/{id}/private/meta` | checkout / claim / assign | Rate fixed at order time; the store that checks the PIN never sees it. |
| `rating, ratingCount` | `stores` | `onStoreReviewWritten` | Store cards need no aggregation. |
| `cityId`, `vehicle.capacityClass` (+ claims) | `users` | `setDriverStatus`, `reviewDriverVehicle` | Board filtering and rules without extra reads. |
| `stats.nonCancelledOrders`, `promoUses` | `users` | `placeOrder` transaction (+1), `syncOrderAggregate` (−1 when an order ends cancelled) | O(1), race-safe first-order and promo checks. |
| Thread summary and unread counts | `supportThreads` | `onSupportMessageCreated` | Inbox lists. |

### 1.5 Reference data (constants in shared)

**Categories** (`CATEGORY_IDS` order = `sortOrder` 1–25; `iconKey` = `cat-<id>`; tints cycle the nine
Big Cart pastels `#E6F2EA #FFE9E5 #FFF6E3 #F3EFFA #DCF4F5 #FFE8F2 #D2EFFF #FDEFD5 #E8F5DA`).
Shipping defaults are used when a supplier row has no weight or size (`shipEstimated: true`).

| id | name | default kg | default cm (l×w×h) | synonyms (search) |
| --- | --- | --- | --- | --- |
| adhesives | Adhesives | 0.5 | 25×6×6 | glue, caulk, sealant, cement |
| fasteners | Fasteners | 1 | 15×10×8 | screws, nails, anchors, hangers |
| tools | Tools | 1 | 40×15×8 | tool, drill, saw |
| safety | Safety | 0.3 | 30×25×10 | ppe, gloves, hard hat |
| wood | Wood | 10 | 244×9×4 | lumber, studs, sheathing, plywood, osb |
| drywall | Drywall | 25 | 244×122×1.3 | gypsum, sheetrock, gyprock, mud |
| insulation | Insulation | 9 | 120×40×40 | batts, foam, soundproofing, vapour |
| masonry | Masonry | 30 | 60×40×12 | concrete, cement, mortar, block, rebar, steel |
| roofing | Roofing | 25 | 100×33×13 | shingles, underlayment, waterproofing |
| electrical | Electrical | 1 | 30×20×10 | wire, cable, romex, lighting |
| plumbing | Plumbing | 2 | 120×10×10 | pipe, pex, copper, abs |
| hvac | HVAC | 2 | 60×20×20 | duct, furnace, ventilation |
| doors | Doors | 30 | 210×90×10 | door, prehung |
| windows | Windows | 15 | 100×70×10 | window |
| glass | Glass | 10 | 90×60×3 | mirror, glass |
| hardware | Hardware | 0.5 | 20×10×5 | hinges, bolts, pulls |
| paint | Paint | 5 | 20×20×25 | primer, roller, tape |
| flooring | Flooring | 15 | 122×20×10 | vinyl, laminate, tile |
| wall-decor | Wall Decor | 3 | 244×10×2 | trim, baseboard, casing, millwork, panel |
| cleaning | Cleaning | 1 | 40×30×10 | bags, vacuum |
| storage | Storage | 15 | 100×50×15 | shelving, toolbox |
| bath | Bath | 15 | 80×50×40 | toilet, shower, vanity |
| kitchen | Kitchen | 10 | 80×60×40 | cabinets, faucet, sink |
| appliances | Appliances | 50 | 150×60×60 | range, water heater |
| outdoors | Outdoors | 20 | 122×61×5 | decking, fencing, landscaping, pavers, siding |

**`SUGGEST_STORE_INTERESTS`** (the 24 chips the site shows, verbatim; 15 more sit behind its "+ 15 more"
chip and aren't readable from the page): Lumber, Drywall, Electrical,
Plumbing, Hardware, Paint, Concrete & Masonry, Insulation, Tools & Safety, HVAC, Roofing, Flooring
& Tile, Doors & Windows, Kitchen & Bath, Cabinets & Millwork, Lighting, Fasteners, Glass &
Mirrors, Decking & Fencing, Siding & Exteriors, Landscaping, Steel & Rebar, Waterproofing,
Appliances.

**`STORE_SPECIALTY_LABELS`**: lumber_building "Lumber & Building Materials", drywall_paint
"Drywall & Paint", electrical "Electrical", plumbing "Plumbing", hvac_refrigeration "HVAC &
Refrigeration", fasteners_hardware "Fasteners & Hardware", glass_mirrors "Glass & Mirrors",
doors_trims "Doors, Trims & Baseboards", kitchen_cabinets "Kitchen Cabinets", bath_fixtures "Bath
& Plumbing Fixtures", designer_lighting "Designer Lighting", insulation_soundproofing
"Soundproofing & Insulation", masonry_roofing "Masonry & Roofing". The first twelve are the site's
wording; `masonry_roofing` is ours (no site card uses it) so roofing and masonry have a seed store.

**`CITIES`** (centers for `nearestCity`): toronto 43.6532,−79.3832 · mississauga 43.5890,−79.6441 ·
brampton 43.7315,−79.7624 · vaughan 43.8361,−79.4983 · markham 43.8561,−79.3370 · richmond_hill
43.8828,−79.4403 · oakville 43.4675,−79.6877 · burlington 43.3255,−79.7990 · milton
43.5183,−79.8774 · pickering 43.8384,−79.0868 · ajax 43.8509,−79.0204 · whitby 43.8975,−78.9429 ·
oshawa 43.8971,−78.8658 · newmarket 44.0592,−79.4613 · aurora 44.0065,−79.4504. Toronto also has
**anchors** North York 43.7615,−79.4111 · Scarborough 43.7731,−79.2577 · Etobicoke 43.6600,−79.5300
(with centers alone, Scarborough pins land in Markham, North York in Vaughan and north Etobicoke in
Mississauga). `nearestCity` picks the nearest center or anchor; a geocoded municipality
(`geocodeAddress`) wins over it, so it only decides dropped pins and is approximate near borders.

---

## 2. State machines

All tables live in shared code (`marketplace.ts`, `status.ts`, `quotes.ts`, `issues.ts`) with a
`canX(from, to, actor, ctx)` helper each. Callables enforce them; triggers never move a document.
Actors: `customer`, `supplier` (a member of the store), `driver`, `staff` (admin or dispatcher),
`system` (schedules and cascades).

### 2.1 Store order

| From | To | Actor | Entry point | Checks and effects (all in the entry point's transaction) |
| --- | --- | --- | --- | --- |
| new | accepted | supplier, staff | `acceptStoreOrder` | Optional shortages (§2.1.1). For delivery: set `offerOpensAt`, create the job offer (`scheduled` or `open`, §2.4). |
| new | rejected | supplier, staff | `rejectStoreOrder` | Reason required. Void amounts, release stock, cancel the delivery and delete the offer. |
| new | rejected | system | `escalateStoreOrders` | `respondBy + 20 min` passed; reason `no_response`. Same effects. |
| new, accepted | cancelled | customer | `cancelOrder` | `cancelledBy: 'customer'`. Same effects as reject. |
| accepted, preparing, ready | cancelled | supplier | `rejectStoreOrder` | `cancelledBy: 'store'`, reason required. Same effects (goods still at the store; a driver who already checked in gets cancellation pay, §3.9). |
| new, accepted, preparing, ready | cancelled | staff | `rejectStoreOrder` | `cancelledBy: 'staff'`. Same effects (goods still at the store). |
| accepted | preparing | supplier, staff | `updateStoreOrderStatus` | — |
| accepted, preparing | ready | supplier, staff | `updateStoreOrderStatus` | Optional shortages. `pickup.readyAt = now`. Delivery: `pickup.ready = true`, offer `pickup.ready = true`, driver notified. Pickup: `holdUntil` (§4.5), customer gets the PIN. |
| ready | preparing | supplier, staff | `updateStoreOrderStatus` | "Not ready after all"; only before hand-over. Reverses `pickup.ready`. |
| ready | out_for_delivery | supplier, staff | `completePickup` (driver's PIN) | Delivery must be `accepted` by its driver. Delivery → `picked_up`, stock committed, wait pay computed. |
| ready | picked_up | supplier, staff | `completePickup` (customer's PIN) | Pickup fulfilment. Stock committed. `completedAt`. |
| ready (pickup) | cancelled | system | `expirePickupHolds` | `holdUntil` passed (not collected). Release stock, void amounts. |
| out_for_delivery | delivered | driver, staff | `completeDelivery` / `updateDeliveryStatus(delivered)` | Delivery → `delivered` in the same transaction. `completedAt`. |
| out_for_delivery | failed | driver, staff | `updateDeliveryStatus(failed)` | Delivery → `failed`. Order `needsAttention`. Staff alerted. |
| failed | out_for_delivery | staff | `resolveFailedDelivery(reattempt)` | Delivery `failed → picked_up`, `attempts + 1`, optional new window. |
| failed | cancelled | staff | `resolveFailedDelivery(return_to_store)` | Delivery → `cancelled`; restock `stockOnHand += fulfilledQty`; amounts per §3.7 (items never charged; the locked delivery and labourer fees are charged only for a site-caused failure, unless staff set `refundDeliveryFee`). |

**Final statuses:** `delivered`, `picked_up`, `rejected`, `cancelled`. `failed` always needs a
staff resolution.

**Labels.** Supplier board: New · Accepted · Preparing · Ready · Out for delivery · Delivered ·
Picked up · Delivery failed · Rejected · Cancelled. Customer: new "Waiting for {store} to
confirm", accepted "Confirmed", preparing "Being prepared", ready "Packed — finding a driver"
(delivery) or "Ready for pickup" (pickup), out_for_delivery "On the way", delivered "Delivered",
picked_up "Picked up", failed "Delivery issue — we're on it", rejected "Not available",
cancelled "Cancelled". Exported as `STORE_ORDER_META[status] = { label, customerLabel, tone, column }`.

#### 2.1.1 Shortages (adjustments)

`adjustments: { lineId, fulfilledQty, reason: ShortReason }[]` may accompany `acceptStoreOrder`,
`updateStoreOrderStatus(ready)` and `completePickup`. Rules: `0 ≤ fulfilledQty ≤` the line's current
`fulfilledQty` (quantities only go down); `custom` lines may be shorted too. Effects: line
updated, `current = settleStoreOrder(...)` (§3.6), `product.reserved −= Δ`, and when the reason is
`out_of_stock` the product's `stockOnHand` is clamped to `reserved` after the change (available
becomes 0, so the item the store just said it lacks is not re-sold). Shorting **every** line to 0
is a reject (from `new`) or a store cancel (from `accepted`, `preparing` or `ready`), with reason
`out_of_stock`. Every adjustment bumps `version` and appends a history entry ("Boltbin: 20 of 24
joist hangers — out of stock").

### 2.2 Order status (derived, never set directly)

`orderStatusFromStoreOrders(statuses)`:

1. Ignore `rejected` and `cancelled`. If nothing is left → `cancelled`.
2. Otherwise the order takes the status of its **slowest** remaining store order:

| Store order | Rank | Order status |
| --- | --- | --- |
| new | 0 | placed |
| accepted | 1 | confirmed |
| preparing | 2 | preparing |
| ready, failed | 3 | ready |
| out_for_delivery | 4 | on_the_way |
| delivered, picked_up | 5 | completed |

`needsAttention = any failed || any acceptOverdue`. **Settled** = every store order is final; that
triggers payment finalization (§3.8). `orderHeadline(order)` (first match wins) drives the UI copy:
cancelled "Cancelled" → completed "Completed" (+ " · 1 store cancelled" when any were void) → any
failed "Delivery issue — we're on it" → any out_for_delivery "On the way · {d} of {n} delivered" →
any pickup store order ready "Ready for pickup" → any new "Waiting for {k} store{s} to confirm" →
all remaining ready "Ready — finding a driver" → otherwise "Preparing your order".

### 2.3 Delivery (existing machine, small diff)

`canTransition(from, to, actor, ctx?: { requiresPickup?: boolean })`, `TransitionActor = 'driver' | 'staff' | 'system'`.
`requiresPickup` is true when `delivery.pickup != null && pickup.collectedAt == null`.

| Change | Rule |
| --- | --- |
| Driver, `accepted` | Manual deliveries keep `picked_up, in_transit, failed` and gain `unassigned` (**release**, reason from `DECLINE_REASONS`; today a driver can't leave `accepted` that way). With `requiresPickup`: only `unassigned` (release). `accepted → picked_up` happens only through `completePickup`. |
| Driver release / decline | `assigned → unassigned` (decline) and `accepted → unassigned` (release) add the driver to `declinedBy`, set `releasedBy[uid] = now`, clear `pickup.pickupCode`, and (marketplace deliveries) re-create the job offer in the same transaction (§2.4 re-creation rule). The meta PIN left behind is dead: `completePickup` checks `pickupCodeIssuedTo === delivery.driverId`. |
| Staff | As today, plus `failed → picked_up` (re-attempt with the goods still loaded). On marketplace deliveries staff may **not** use `updateDeliveryStatus` for `picked_up` (use `completePickup` with an override) or `cancelled` (cancel the store order), may not move an uncollected delivery past `accepted` (no `in_transit`, `arrived`, `delivered` or `failed` while `requiresPickup`), leave `failed` only through `resolveFailedDelivery`, and may not unassign or reassign after collection. |
| System | `unassigned → accepted` (`claimJob`), `accepted → picked_up` (`completePickup`), any open status `→ cancelled` (store order rejected or cancelled before collection). These are checked against the `system` table, but the audit event names whoever caused them: the claiming driver (`actorRole: 'driver'`), the store member who entered the PIN (`'supplier'`) or staff; `actorRole: 'system'` (`SYSTEM_ACTOR`) is only for schedules and cascades. |
| Proof | `completeDelivery` by a driver on a marketplace delivery requires `photoPath` (`requirePhoto`): an object that exists under `proofs/{deliveryId}/`, checked with the Admin SDK before the transaction. It also requires the hand-off code when `requireCode` (= `receiving === 'attended'`). Recipient name is optional. COD is gone. |

**Coupling (one transaction each):**

| Event | Delivery | Store order | Job offer | Callable |
| --- | --- | --- | --- | --- |
| Checkout (delivery) | created `unassigned`, `offerStatus: 'held'` | `new` | — | `placeOrder` |
| Store accepts | `offerOpensAt`, `offerStatus` scheduled/open | `accepted` | created | `acceptStoreOrder` |
| Store marks ready | `pickup.ready`, `readyAt` | `ready` | `pickup.ready = true` | `updateStoreOrderStatus` |
| Driver claims | `unassigned → accepted`, driver set, new PIN | projection | deleted | `claimJob` |
| Dispatch assigns | `→ assigned`, new PIN | projection | deleted | `assignDelivery` |
| Decline / release / unassign before collection | `→ unassigned`, `pickup.pickupCode` cleared | projection | re-created (§2.4) | `updateDeliveryStatus`, `assignDelivery(null)` |
| Driver at the counter | `pickup.arrivedAt` | projection (`at_store`) | — | `checkInAtStore` |
| Store enters driver PIN | `accepted → picked_up`, `pickup.collectedAt` | `ready → out_for_delivery` | — | `completePickup` |
| Drop-off with proof | `→ delivered` | `→ delivered` | — | `completeDelivery` |
| Failed at the site | `→ failed` | `→ failed` | — | `updateDeliveryStatus` |
| Re-attempt | `failed → picked_up` | `failed → out_for_delivery` | — | `resolveFailedDelivery` |
| Return to store | `failed → cancelled` | `failed → cancelled` | — | `resolveFailedDelivery` |
| Reject / cancel before collection | `→ cancelled` | `→ rejected / cancelled` | deleted | `rejectStoreOrder`, `cancelOrder`, `escalateStoreOrders` |

"Projection" = `storeOrder.driver`, written by `projectDriverOntoStoreOrder` from `onDeliveryWritten`
only when `after.updatedAt > storeOrder.driverSyncedAt` (never backwards; `driverSyncedAt` is kept when
`driver` becomes null, so a late event can't bring back a driver who released the job). Phase mapping:
assigned → `assigned`; accepted (no `arrivedAt`) → `to_store`; accepted + `arrivedAt` →
`at_store`; picked_up → `loaded`; in_transit → `to_site`; arrived → `at_site`; delivered →
`delivered`; failed → `problem`; unassigned/cancelled → `driver: null`.

**Driver's main action** (`primaryDriverAction(delivery)`, result gains `kind: 'status' | 'check_in' | 'wait' | 'show_pin'`):
assigned "Accept job" · accepted + pickup, not arrived "I'm at the store" (`check_in`) · arrived,
store not ready "Waiting for the store" (`wait`, disabled) · arrived, ready "Show pickup PIN"
(`show_pin`; the store types it) · accepted, manual "Mark as picked up" · picked_up "Start trip to
site" · in_transit "I've arrived" · arrived "Complete delivery" (proof).

**Customer labels** (`customerLabelFor(status, kind)`): marketplace accepted "Driver heading to the
store", picked_up "Loaded at the store", in_transit "On the way to your site", arrived "Driver at
your site"; manual deliveries keep today's labels.

**`FAILURE_REASONS`** (id · label · site-caused?): `no_one_on_site` Nobody on site · yes;
`site_closed` Site locked or closed · yes; `access_issue` Couldn't access the site (gate, no room
for the truck) · yes; `wrong_address` Wrong or incomplete address · yes; `refused` Refused at the
site · yes; `unsafe_to_unload` Unsafe to unload · yes; `damaged` Material damaged in transit · no;
`vehicle_issue` Vehicle problem · no; `other` Other · no. (`customer_unavailable` is renamed
`no_one_on_site`.)

**`DECLINE_REASONS`** (decline and release): `too_far`, `load_too_large`, `vehicle_issue`,
`schedule_conflict`, `store_delay`, `other`.

**`QUICK_REPLIES`** (driver chat): "On my way to the store", "Loading now", "Store says the order
isn't ready", "On my way to the site", "Arrived — nobody on site", "Need help unloading",
"Vehicle issue, please advise".

### 2.4 Job offer

- **Exists** exactly while its delivery is `unassigned` with `offerStatus ∈ {scheduled, open}`.
- **Created** by `acceptStoreOrder`: `opensAt = max(now, targetPickupAt − 12 h)`; `status = 'open'`
  (and `openedAt = now`) when `opensAt ≤ now`, else `'scheduled'`. Only while the delivery is still
  `unassigned`: one that dispatch already assigned during `held` keeps its driver (`offerStatus: 'claimed'`).
- **Re-created** on decline, release, unassign before collection, or the suspension of the driver
  (§5.4) with `opensAt = max(now, delivery.offerOpensAt)` (so `scheduled` or `open` by the same
  rule). While the store order is still `new` there is no offer: the delivery goes back to
  `offerStatus: 'held'` and `acceptStoreOrder` creates the offer later.
- **`delivery.offerStatus`** mirrors it: `held` (store hasn't accepted) → `scheduled` / `open` (offer
  exists) → `claimed` (claimed, or assigned by dispatch) · `withdrawn` (cancelled before collection).
  Manual deliveries keep `null`.
- **Opened** by `publishDueJobOffers` (every 5 min): `scheduled` offers with `opensAt ≤ now` →
  `open`, in a transaction that re-reads the delivery and deletes the offer instead if the
  delivery is no longer `unassigned`.
- **Deleted** by `claimJob` (claimed), `assignDelivery` (dispatch), and any cancellation.
- **Audience** = `audienceFor(cityIds, jobClass, siteMax)`: every `"{city}:{class}"` for `city ∈
  {store.cityId, jobsite.cityId}` and `class` from the job's class up to `min(flatbed,
  jobsite.maxVehicleClass)`. Drivers see an offer when `"{claims.cityId}:{claims.capacityClass}"`
  is in it.

### 2.5 Quote

| From | To | Actor | Entry point |
| --- | --- | --- | --- |
| — | submitted | customer | `submitMaterialList` |
| submitted | in_review | staff | direct write (open or assign, allowed by rules) |
| submitted, in_review, quoted, expired | quoted (`offer.version + 1`) | staff | `sendQuote` |
| quoted | accepted | customer | `acceptQuote` (creates the order, sets `orderId`) |
| submitted, in_review, quoted | declined | customer | `closeQuote` |
| submitted, in_review | cancelled | staff | `closeQuote` (for example "can't source it") |
| quoted | expired | system | `expireQuotes` (`offerValidUntil` passed) |
| quoted, expired | in_review | customer | `reopenQuote` ("Request changes" / "Get a fresh quote") |

### 2.6 Issue

`open → in_review` (staff, direct write when assigning) → `resolved` (staff, `resolveIssue` with kind
`refund`, `replacement` or `no_action`). Only `reportIssue` creates one, within 48 h of the store
order's `completedAt`, one open issue per store order. While an issue is open the store's
not-yet-paid ledger entries for that store order are held (§3.9).

### 2.7 Payment

`authorized → capture_pending → captured` (or `capture_failed`, retried by the sweep) ·
`authorized → voided` (nothing to capture) · `captured → partially_refunded → refunded` ·
`not_required` for replacement orders. Every step appends a `PaymentEvent`.

### 2.8 Accounts

- **Store** (`status`, admin only): `onboarding → coming_soon → live ⇄ closed`. Only `live` stores
  are orderable; `acceptingOrders: false` ("Pause new orders", any store member) blocks new
  checkouts but keeps the store listed. Badges: onboarding "Onboarding now", coming_soon "Coming
  soon", live + paused "Paused", live + outside hours "Closed · opens 7:00 am". Non-live cards show
  "Joining InstaSupply" instead of a delivery promise.
- **Supplier user:** `active ⇄ suspended` (`setSupplierUserStatus`; suspension disables the Auth
  user and revokes refresh tokens, like drivers).
- **Driver:** `pending → active ⇄ suspended` (`setDriverStatus`, admin). Approval requires
  `compliance.licenceVerified && compliance.insuranceVerified` (checked by ops by phone; `force`
  only in the seed). Vehicle changes after approval go to `vehicleDraft` with
  `vehicleReviewRequired: true`; `reviewDriverVehicle` approves (draft → `vehicle`, claims
  refreshed) or rejects. Claims change only on approval; meanwhile `claimJob` also requires the job
  to fit the draft vehicle, so a downgrade (sold the pickup, now drives a car) applies at once.
  Suspension releases the driver's uncollected marketplace jobs (offers re-created, §2.4) and alerts
  staff about deliveries already collected.

---

## 3. Money

### 3.1 Arithmetic and rounding (`money.ts`)

1. Integer cents everywhere; a line total is `unitPriceCents × quantity`, exactly.
2. `mulDivHalfUp(a, b, c) = Math.floor((2·a·b + c) / (2·c))` for non-negative integers (half-up).
3. `percentBps(cents, bps) = Math.floor((cents·bps + 5000) / 10000)` (half-up). HST:
   `percentBps(taxable, 1300)`.
4. `allocate(total, weights)`: floor shares, then the leftover cents go to the largest exact
   remainders `(total·wᵢ) mod W`, ties to the lower index. Parts always sum to `total`.
5. Road distance in tenths: `roadTenths(a, b) = Math.ceil(haversineMeters(r6(a), r6(b)) × 1.35 / 100 − 1e-6)`,
   where `r6` rounds lat/lng to 6 decimals and 1.35 is the existing `ROAD_DISTANCE_FACTOR`. The
   epsilon keeps Hermes and V8 identical at boundaries. `roadKm = roadTenths / 10`.
6. Per-km money: `mulDivHalfUp(perKmCents, tenths, 10)`.
7. Load weight in integer grams (`unitG = round(weightKg × 1000)`), volume in integer mm³
   (`round(cm × 10)` per side): no float sums.
8. Percent promos round **down**; discounts are allocated by rule 4; tax is half-up **per store
   order**; order tax = Σ store-order tax.
9. Driver offers round **up** to the next $0.25 (`ceilTo25(x) = Math.ceil(x / 25) × 25`); commission
   is half-up.
10. Invariants: no amount below 0; `current ≤ placed` per store order; `captured ≤ authorized`;
    `refunded ≤ captured`.
11. `formatMoney(cents)` is hand-written (no `Intl`): `$1,284.50`, `-$12.21`; `formatFee(0) = 'Free'`.

### 3.2 Constants (`pricing.ts`)

```ts
export const TAX_RATE_BPS = 1300;                          // Ontario HST
export const FREE_DELIVERY_MIN_ITEMS_CENTS = 50_000;       // order items (before discounts) ≥ $500.00 ⇒ all delivery fees $0
export const FIRST_ORDER_FREE_DELIVERY = true;             // "$0 delivery fee on your first order" (no cap)
export const FIRST_ORDER_DISCOUNT_CENTS = 2_000;           // "$20 off your first order over $250"
export const FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS = 25_000;
export const INCLUDED_ROAD_TENTHS = 100;                   // first 10.0 km included in every class base fee
export const MAX_CART_LINES = 100;
export const MAX_LINE_QUANTITY = 9_999;
export const MAX_STORES_PER_ORDER = 5;                     // letters A–E
export const DISPATCHER_REFUND_LIMIT_CENTS = 10_000;       // admins unlimited
export interface Promo { code: string; kind: 'fixed' | 'percent'; valueCents?: number; percent?: number;
  maxDiscountCents?: number; minItemsCents: number; firstOrderOnly: boolean; maxUsesPerCustomer: number | null;
  startsOn: string; endsOn: string; label: string }
export const PROMOS: Record<string, Promo> = {
  BUILD25: { code: 'BUILD25', kind: 'fixed', valueCents: 2_500, minItemsCents: 75_000, firstOrderOnly: false,
    maxUsesPerCustomer: null, startsOn: '2026-11-01', endsOn: '2027-03-31', label: '$25 off orders of $750+' },
  CREW5: { code: 'CREW5', kind: 'percent', percent: 5, maxDiscountCents: 10_000, minItemsCents: 100_000,
    firstOrderOnly: false, maxUsesPerCustomer: 1, startsOn: '2026-11-01', endsOn: '2027-03-31',
    label: '5% off $1,000+ (max $100), once per account' },
};
```

"Over $500" and "over $250" are implemented as "at least" (one constant each to flip).

### 3.3 Vehicle classes and the load (`vehicles.ts`)

| Class | Rank | Max kg | Max length cm | 4×8 sheets | Max volume L | Fee base (incl. 10 km) | Fee / extra km | Labourer fee | Driver base | Driver / km | Speed km/h | Loading min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| car | 0 | 150 | 150 | no | 350 | $12.99 | $0.99 | not offered | $9.00 | $0.75 | 40 | 5 |
| suv | 1 | 350 | 200 | no | 1,500 | $19.99 | $1.19 | $35.00 | $11.00 | $0.85 | 40 | 10 |
| pickup | 2 | 700 | 250 | yes | 2,500 | $29.99 | $1.49 | $35.00 | $16.00 | $1.00 | 38 | 15 |
| cargo_van | 3 | 1,300 | 370 | yes | 9,000 | $44.99 | $1.79 | $45.00 | $22.00 | $1.15 | 36 | 15 |
| box_truck | 4 | 3,500 | 490 | yes | 22,000 | $79.99 | $2.49 | $60.00 | $40.00 | $1.50 | 32 | 20 |
| flatbed | 5 | 6,000 | 740 | yes | 30,000 | $99.99 | $2.99 | $75.00 | $50.00 | $1.75 | 30 | 20 |

Exported as `VEHICLE_CLASSES: Record<VehicleClass, { rank, maxKg, maxLengthCm, sheets, maxVolumeL,
feeBaseCents, feePerKmCents, labourerFeeCents | null, driverBaseCents, driverPerKmCents, speedKmh,
loadMinutes, label }>` (labels: Car, SUV, Pickup truck, Cargo van, Box truck, Flatbed). The route
planner and tracking use `speedKmh` of the driver's `capacityClass` (replaces `VEHICLE_META`).

**`summarizeLoad(lines)`:**
- `pieces = Σ q`; `weightG = Σ q·unitG`; `weightKg = round1(weightG / 1000)`; `heaviestUnitKg = max unitG / 1000`.
- `longestCm = max dims.l`; `hasSheets = any (l ≥ 240 && w ≥ 120)`.
- `volumeL = Math.ceil(Σ q·lmm·wmm·hmm × 12 / 10⁷)` (litres × 1.2 packing factor).
- `handlingPieces = Σ q` over lines with `unitG ≥ 23 000` or `l ≥ 240` or a sheet.
- `heavy = weightG ≥ 250 000 || heaviest unit ≥ 40 kg`.
- `vehicleClass` = the lowest rank meeting all four limits, else `null` (`too_large`: "Too large
  for one delivery. Send us your list for a quote.").
- `summary` = first two lines `"{q} × {name}"` joined with ", ", then `" +{n} more"`.

**Driver vehicle → `capacityClass`** (`capacityClassFor(vehicle)`): car → car; suv → suv; pickup →
pickup when `boxLengthFt ≥ 6.5`, else suv; cargo_van, box_truck, flatbed → same; dump_truck →
pickup; other → car. Staff may override at approval or vehicle review. `canCarry(capacity, job) =
rank(capacity) ≥ rank(job)`.

**Formulas:**
- Customer list fee: `deliveryFeeListCents = feeBaseCents + mulDivHalfUp(feePerKmCents, max(0, roadTenths − 100), 10)`.
- Drive minutes: `Math.ceil(6 · roadTenths / speedKmh)`.
- Driver offer: `baseCents = driverBaseCents`; `distanceCents = mulDivHalfUp(driverPerKmCents,
  roadTenths, 10)`; `loadCents = 100 · ceil(max(0, weightG − 100 000) / 50 000)` ($1 per started
  50 kg above 100 kg); `handlingCents = min(3 000, 15 · handlingPieces)`; `offerCents =
  ceilTo25(max(1 000, base + distance + load + handling))`. `totalCents = offerCents + boostCents
  + waitCents` (§3.10).

### 3.4 `priceCheckout(input): PricedCheckout` — the only pricing function

```ts
export interface PricingLine { lineId: string; kind: 'catalog' | 'custom'; productId: string | null; name: string;
  unit: SellUnit; size: string | null; unitPriceCents: number; quantity: number; weightKg: number; dimsCm: DimsCm }
export interface PricingStoreInput { storeId: string;
  store: Pick<Store, 'name' | 'location' | 'status' | 'acceptingOrders' | 'fulfilment'>; lines: PricingLine[] }
export interface CheckoutInput {
  fulfilment: Fulfilment; stores: PricingStoreInput[];
  dropoff: { location: LatLng; receiving: Receiving; maxVehicleClass: VehicleClass | null } | null; // delivery only
  unloadHelpStoreIds: string[]; promoCode: string | null;
  customer: { isFirstOrder: boolean; promoUses: Record<string, number> };
  source: 'cart' | 'quote' | 'replacement'; today: string /* Toronto date; promo validity only */ }
export type PricingErrorCode = 'empty' | 'too_many_stores' | 'no_dropoff' | 'store_unavailable' | 'store_paused'
  | 'delivery_unavailable' | 'pickup_unavailable' | 'out_of_range' | 'too_large' | 'jobsite_vehicle_limit';
export interface PricingError { code: PricingErrorCode; storeId: string | null; message: string }
export type PromoStatus = 'applied' | 'not_better' | 'invalid' | 'expired' | 'min_not_met' | 'first_order_only' | 'used_up';
export interface PricedStore extends Amounts { storeId: string; letter: string;
  lines: (PricingLine & { lineCents: number; discountCents: number })[];
  load: LoadSummary; vehicleClass: VehicleClass | null; roadTenths: number | null; roadKm: number | null;
  deliveryFeeListCents: number; feeWaiver: 'first_order' | 'free_threshold' | 'replacement' | null;
  unload: { offered: boolean; required: boolean; selected: boolean; feeCents: number };
  requireCode: boolean; errors: PricingError[] }
export interface PricedCheckout extends Amounts { currency: 'CAD'; taxRateBps: 1300; stores: PricedStore[];
  itemCount: number; lineCount: number; discounts: AppliedDiscount[] /* 0 or 1 */;
  promo: { code: string; status: PromoStatus; message: string } | null;
  freeDelivery: 'first_order' | 'free_threshold' | null;
  amountToFreeDeliveryCents: number; amountToFirstOrderDiscountCents: number;
  canPlace: boolean; blockers: PricingError[] }
```

Stock and time are **not** inputs (checked separately, §5.5.1), so the result never depends on the
clock except promo dates. Steps:

1. **Normalize.** Drop zero-quantity lines; sort stores by `storeId`; assign letters A, B, …
   Blockers: no lines → `empty`; more than 5 stores → `too_many_stores`; delivery without
   `dropoff` → `no_dropoff`.
2. **Per store.** `lineCents = unitPriceCents × quantity`; `itemsCents = Σ lineCents`; `load =
   summarizeLoad(lines)`; delivery: `roadTenths(store.location, dropoff.location)`. Errors:
   `store.status !== 'live'` → `store_unavailable`; `!acceptingOrders` → `store_paused`;
   fulfilment not offered → `delivery_unavailable` / `pickup_unavailable`; `roadKm >
   deliveryRadiusKm` → `out_of_range` ("Kestrel delivers within 45 km; your site is 52.3 km away");
   `load.vehicleClass === null` → `too_large`; `rank(class) > rank(dropoff.maxVehicleClass)` →
   `jobsite_vehicle_limit`. Stores with errors are still priced (preview) but block placing.
3. **Discount (one at most).** `orderItems = Σ itemsCents`. Welcome: `isFirstOrder && source !==
   'replacement' && orderItems ≥ 25 000` → 2 000. Promo (code upper-cased and trimmed): unknown →
   `invalid`; outside `startsOn..endsOn` → `expired`; `firstOrderOnly && !isFirstOrder` →
   `first_order_only`; uses ≥ `maxUsesPerCustomer` → `used_up`; `orderItems < minItemsCents` →
   `min_not_met` ("Add $220.70 more to use CREW5"); else fixed `min(valueCents, orderItems)` or
   percent `min(maxDiscountCents, floor(orderItems·percent/100))`. If welcome ≥ promo and welcome >
   0 → welcome applies and a valid promo is `not_better` (not consumed); otherwise the promo
   applies (`applied`). The discount never exceeds `orderItems`.
4. **Allocate** the discount across stores by `itemsCents`, then within each store across lines
   by `lineCents` (§3.1 rule 4). Line shares are stored (`StoreOrderLine.discountCents`) for exact
   settlements and refunds.
5. **Delivery fee** (delivery only): `deliveryFeeListCents` per store from its class and
   `roadTenths`. Waiver for every store: replacement → `replacement`; `isFirstOrder` →
   `first_order`; `orderItems ≥ 50 000` → `free_threshold`. Waived stores charge 0 (the list fee is
   still returned so the UI can strike it through).
6. **Unload help** (delivery only): `offered = labourerFeeCents != null`; `required = offered &&
   receiving === 'unattended' && load.heavy`; `selected = offered && (required ||
   unloadHelpStoreIds.includes(storeId))`; `unloadFeeCents = selected && source !== 'replacement' ?
   labourerFeeCents : 0`.
7. **Tax and totals per store.** `taxable = items − discount + deliveryFee + unloadFee`; `tax =
   percentBps(taxable, 1300)`; `total = taxable + tax`. Order amounts are sums, so per-store receipts
   always add up exactly. `requireCode = delivery && receiving === 'attended'`.
8. **Meters.** `amountToFreeDeliveryCents = delivery && !isFirstOrder && freeDelivery === null ?
   50 000 − orderItems : 0`. `amountToFirstOrderDiscountCents = isFirstOrder && orderItems < 25 000
   ? 25 000 − orderItems : 0`. `canPlace = blockers.length === 0 && (orderItems > 0 || source ===
   'replacement')`, where blockers = step-1 blockers + every store error.

HST applies to merchandise net of discounts, to delivery fees and to the labourer fee. The
platform funds discounts and fee waivers; suppliers are paid on full item value (§3.9).

### 3.5 Who calls it

| Caller | Lines from | `isFirstOrder` | Notes |
| --- | --- | --- | --- |
| Cart and checkout preview (G, H) | live product and store documents | `profile.stats.nonCancelledOrders === 0` | Before a jobsite is chosen the cart shows "Delivery from $12.99". |
| `placeOrder` (B) | documents read in its transaction | same, read in the transaction | Total must equal `expectedTotalCents`. |
| Quote builder (I2) and `sendQuote` (E) | catalogue lines with optional `unitPriceCents` overrides + custom lines | customer's current value | Snapshot stored in `offer.pricing`. |
| `acceptQuote` (E) | the offer's lines at quoted unit prices | current value at acceptance | Mismatch → `PRICE_CHANGED`. |
| Replacement (E) | issue lines at 0 | false | `source: 'replacement'`. |
| Seed (K), unit tests (A) | fixtures | — | Seeding proves app and server agree. |

### 3.6 Settlement after shortages or voids — `settleStoreOrder(lines, placed)`

- All `fulfilledQty` = 0 (or rejected/cancelled before hand-over) → **void**: every amount 0.
- Otherwise `items = Σ unitPriceCents × fulfilledQty`; `discount = Σ mulDivHalfUp(line.discountCents,
  fulfilledQty, quantity)`; `deliveryFee` and `unloadFee` stay as placed (**locked**; they never
  go up and are not re-evaluated against the $500 threshold); tax and total recomputed.
- Sibling store orders are never touched. The difference `placed.total − current.total` is
  released at capture ("You won't be charged $12.21 for items Boltbin couldn't supply").
- `storeValueCents = Σ unitPriceCents × fulfilledQty` (equals `current.itemsCents` except for
  replacements, where it is priced from the catalogue).

### 3.7 Refunds — `refundForLines(storeOrder, lines, { includeDeliveryFee })`

- `itemsCents = Σ unitPriceCents × q`; `discountCents = Σ mulDivHalfUp(line.discountCents, q,
  line.quantity)`; `feeCents = includeDeliveryFee ? current.deliveryFeeCents + current.unloadFeeCents
  : 0`; `taxCents = percentBps(items − discount + fee, 1300)`; `totalCents = items − discount + fee + tax`.
- Capped at `current.totalCents − refundedByStoreOrder[storeOrderId]` and at `captured − refunded`.
- Failed delivery returned to store (`resolveFailedDelivery(return_to_store)`, before capture): the
  items are never charged; the locked delivery and labourer fees stay in `current` only when the
  failure reason is site-caused (§2.3), and staff can waive them with `refundDeliveryFee: true`.
- Dispatchers can refund at most $100.00 per action; admins have no limit.
- **Clawbacks** (ledger, §3.9): `faultParty: 'store'` → store `−(refunded gross items − commission
  on them)`; `'driver'` → driver `−refunded gross items` (the driver is liable for the value);
  `'platform'` or `'customer'` → none.

### 3.8 Payments (`modules/payments`, test mode)

```ts
export interface PaymentGateway {
  authorize(i: { idempotencyKey: string; amountCents: number; customerId: string;
    card: { cardId: string; brand: CardBrand; last4: string } }):
    Promise<{ ok: true; intentRef: string; captureBefore: number /* epoch ms, from the gateway */ }
      | { ok: false; reason: 'card_declined' | 'insufficient_funds' | 'expired_card' | 'processing_error' }>;
  capture(i: { idempotencyKey: string; intentRef: string; amountCents: number }): Promise<{ ok: true; ref: string } | { ok: false; reason: string }>;
  void(i: { idempotencyKey: string; intentRef: string }): Promise<void>;
  refund(i: { idempotencyKey: string; intentRef: string; amountCents: number; reason: string }): Promise<{ ref: string }>;
  transfer(i: { idempotencyKey: string; payeeType: 'store' | 'driver'; accountRef: string; amountCents: number }): Promise<{ ref: string }>;
}
```

- **Modes** (`PAYMENTS_MODE`): `test` (emulator and staging default), `stripe` (follow-up),
  `disabled` (production default until Stripe is wired: checkout fails with `PAYMENTS_DISABLED`
  "Card payments aren't available yet"; material lists can still be sent, but `acceptQuote` needs
  payments too). In `stripe` mode cards are saved through Stripe's SDK (SetupIntent) and
  `users/{uid}/cards` becomes server-written; client-written cards are a test-mode feature only.
- **`TestGateway`** is deterministic by card last 4: `0002` → `card_declined`, `9995` →
  `insufficient_funds`, `0069` → `expired_card`, `0341` → authorizes but **capture fails**; anything
  else succeeds. Refs: `test_pi_{orderId}`, `test_ch_{orderId}`, `test_re_{key}`, `test_tr_{payoutId}`.
  Save test cards with the published numbers 4242 4242 4242 4242, 5555 5555 5555 4444, 3782 822463
  10005, 4000 0000 0000 0002/9995/0069/0341 (all pass Luhn).
- **Authorize** (`placeOrder`, `acceptQuote`): outside the transaction, key `auth_{orderId}`, amount
  = total. A decline throws `CARD_DECLINED { reason }` and nothing is written. If the order
  transaction then fails **and `orders/{orderId}` still doesn't exist**, `void` with key
  `void_{orderId}` (a concurrent retry with the same `checkoutId` may have created the order with
  this very authorization, which must never be voided). `captureDeadlineAt = min(authorizedAt + 6
  days, captureBefore − 6 h)`; `TestGateway` returns `captureBefore = authorizedAt + 7 days`, Stripe
  the charge's own deadline (shorter for some card networks).
- **Finalize** (`finalizeOrderPayment(orderId)`, called by `syncOrderAggregate` when the order
  settles and by the sweep):
  1. Transaction: if `payment.status ∉ {authorized, capture_failed, capture_pending}` stop
     (`capture_pending` = crash recovery: reuse `pendingCaptureCents`). Amount = Σ
     `current.totalCents` over **all** its store orders, clamped to `authorizedCents`: rejected and
     cancelled store orders are 0, except the retained fees of a failed delivery returned to the
     store (§3.7); in deadline mode unfinished store orders count at their current amount. Amount 0
     → `voided` + `void` event. Otherwise `capture_pending`, `pendingCaptureCents = amount`.
  2. `gateway.capture` with key `capture_{orderId}` (or `void`).
  3. Transaction: success → `captured`, `capturedCents`, `capturedAt`, `capturedByStoreOrder`
     (each store order's `current.totalCents`), events `capture` and `release` (authorized −
     captured); failure → `capture_failed` + staff notification `capture_failed`. After success,
     `recordStoreOrderLedger(orderId)` (§3.9).
- **Deadline sweep** (`captureDuePayments`, every 30 min): retries `capture_failed`, and
  `capture_pending` older than 10 min (a crash between steps 1 and 3), with the same key; captures
  orders still `authorized` at `captureDeadlineAt` in deadline mode. A store order that is later
  reduced or voided after a deadline capture is refunded automatically by the aggregate: amount
  `capturedByStoreOrder[id] − current.totalCents − adjustedByStoreOrder[id]`, key
  `refund_adj_{storeOrderId}_v{version}`.
- **Refund** (`refundOrderPayment`): key `refund_{issueId}` or `refund_adj_…`; updates
  `refundedCents` and `refundedByStoreOrder` (issue refunds) or `adjustedByStoreOrder`
  (`refund_adj_…`), status `partially_refunded`/`refunded`, event.
- **Customer copy:** before capture "Card held · $388.25 — charged when your order is complete";
  after "Paid $388.25"; voided "No charge"; refunds "Refunded $39.22 to Visa ••4242".

### 3.9 Commission, ledger and payouts (`modules/payouts`)

Ledger entries are append-only, written with `create()` (a retried trigger cannot double-count):

| When | Entry id | Payee | Amount |
| --- | --- | --- | --- |
| Order payment captured (or a replacement store order settles) — per delivered/picked-up store order | `sale_{storeOrderId}` | store | `+ storeValueCents` (0 and skipped for a replacement when the store was at fault) |
| same | `commission_{storeOrderId}` | store | `− percentBps(storeValueCents, commissionBps)` (rate from `private/meta`, default 1 000 bps) |
| Delivery `delivered` | `delivery_{deliveryId}_{attempt}` | driver | `+ payout.totalCents` (offer + boost + wait) |
| Delivery `failed` for a site-caused reason (§2.3) | `failed_{deliveryId}_{attempt}` | driver | `+ offerCents + boostCents` |
| Claimed delivery cancelled after check-in or ≥ 15 min after acceptance | `cancel_{deliveryId}` | driver | `+ ceilTo25(max(500, mulDivHalfUp(offerCents, 1, 4)))` |
| Issue resolved with a refund, fault store / driver | `clawback_{issueId}` | store / driver | per §3.7 |

`attempt = delivery.attempts + 1`. Entries for a store order with an open issue get `heldForIssueId`
and are skipped by the payout run until the issue resolves.

**`runDailyPayouts(now)`** (21:00 America/Toronto; also `runJobNow`): for each payee, sum unpaid
entries (`payoutId == null`, `createdAt ≤ now`, not held). Net ≤ 0 → entries carry over. Net > 0 →
payout `{payeeType}_{payeeId}_{runKey}`, in this order: create it `pending` with its `entryIds`; stamp
`payoutId` on those entries (batches of 400, so no later run counts them); `transfer` with key
`payout_{payoutId}`; mark it `paid` with the reference (test mode: `test_tr_…`) and notify the payee
(`payout_sent`). Every run first finishes the `pending` payouts it finds (re-stamp, re-send with the
same key, so a crash or a lost response never pays twice); only a definite refusal marks a payout
`failed` and clears `payoutId` on its entries for the next run (staff alert). Re-running with the same
`now` creates nothing new. **Payout accounts:** in test mode `accountRef` defaults to `test_{payeeType}_{payeeId}`; in `stripe` mode a store
needs `payoutAccount` in `private/settings` and a driver `payoutAccount` on the profile (both set by ops
after Connect onboarding), and a payee without one carries over with a staff alert. Suppliers are paid
the day an order completes; drivers the day they deliver (site promises; orders completing after 21:00
are paid the next day).

### 3.10 Driver pay edge rules

- **Offer** is computed at checkout (§3.3) and frozen in `delivery.payout` and the offer card.
- **Boost** (**P1**, `boostJobPayout`, staff): +$5/$10/$15/$20 before a claim; updates the offer.
- **Wait pay:** `waitMinutes = floor((collectedAt − max(arrivedAt, readyBy)) / 1 min)` when the driver
  checked in; `waitCents = min(1 500, 25 · max(0, waitMinutes − 15))` (25¢/min after a 15-min grace,
  max $15). Computed inside `completePickup`.
- **Failure:** site-caused → offer + boost; driver-caused (`damaged`, `vehicle_issue`) or `other` → 0
  (ops can review).
- **Cancellation after claim:** per §3.9.
- **Release** by the driver: no pay.

### 3.11 Worked examples (unit-test vectors; all distances come from the §11 seed coordinates)

**V1 — Dana's first order (seed scenario A).** Delivery to "Leslieville semi reno" (attended),
labourer requested for Kestrel. Letters follow store ids: A = `bluestone-drywall`, B = `kestrel-lumber`.

| | A · Bluestone Drywall & Paint | B · Kestrel Lumber Yard | Order |
| --- | --- | --- | --- |
| Lines | 6 × Drywall 1/2 in 4×8 @ $18.48 = 11 088; 1 × Joint compound 17 L @ $29.98 = 2 998 | 20 × 2x4x8 SPF stud @ $4.79 = 9 580; 4 × OSB 7/16 in 4×8 @ $22.98 = 9 192 | |
| Items | 14 086 | 18 772 | 32 858 |
| Load | 178.0 kg · 7 pcs · 244 cm · sheets · 320 L → **pickup** | 182.0 kg · 24 pcs · 244 cm · sheets · 368 L → **pickup** | |
| Road km | 22.9 | 26.0 | |
| List fee | 2 999 + mulDivHalfUp(149, 129, 10) = 2 999 + 1 922 = 4 921 | 2 999 + 2 384 = 5 383 | 10 304 |
| Charged fee | 0 (`first_order`) | 0 (`first_order`) | 0 |
| Discount ($20 welcome; items ≥ $250) | 857 (lines: drywall 675, compound 182) | 1 143 (lines: studs 583, OSB 560) | 2 000 |
| Labourer | — | 3 500 (pickup class) | 3 500 |
| Taxable | 13 229 | 21 129 | 34 358 |
| HST | 1 720 | 2 747 | 4 467 |
| **Total** | **14 949** | **23 876** | **38 825 ($388.25)** |
| Driver offer | 1 600 + 2 290 + 200 + 105 = 4 195 → **4 200** | 1 600 + 2 600 + 200 + 360 = 4 760 → **4 775** | |
| Commission | 10 % → 1 409; store net 12 677 | 9 % → 1 689; store net 17 083 | |

**V2 — same cart, repeat customer.** No discount, fees charged: A taxable 14 086 + 4 921 = 19 007,
HST 2 471, total 21 478; B 18 772 + 5 383 + 3 500 = 27 655, HST 3 595, total 31 250; order **52 728
($527.28)**. Free-delivery meter: "Add $171.42 more for free delivery" (50 000 − 32 858 = 17 142).

**V3 — Dana's live order (seed scenario B), code BUILD25, labourer for Kestrel.** Items 77 930 ≥
75 000 so BUILD25 applies ($25.00 > no welcome); items ≥ 50 000 so every fee is `free_threshold`.

| | A · Boltbin | B · Kestrel | C · Voltway | Order |
| --- | --- | --- | --- | --- |
| Lines | 24 × Joist hanger 2x8 @ $2.79 = 6 696; 2 × Deck screws 5 lb @ $34.98 = 6 996 | 24 × stud @ $4.79 = 11 496; 6 × OSB @ $22.98 = 13 788 | 3 × NMD90 14/2 75 m @ $119.98 = 35 994; 20 × Device box @ $1.48 = 2 960 | |
| Items | 13 692 | 25 284 | 38 954 | 77 930 |
| Load → class | 12.0 kg, 18 cm → car | 246.0 kg, sheets, 489 L → pickup | 22.0 kg, 35 cm → car | |
| Road km · list fee | 38.9 · 4 160 | 26.0 · 5 383 | 30.4 · 3 319 | |
| Discount (BUILD25) | 439 (215 / 224) | 811 (369 / 442) | 1 250 (1 155 / 95) | 2 500 |
| Labourer | — | 3 500 | — | 3 500 |
| HST | 1 723 | 3 636 | 4 902 | 10 261 |
| **Total** | **14 976** | **31 609** | **42 606** | **89 191 ($891.91)** |
| Driver offer | 900 + 2 918 = 3 818 → **3 825** | 1 600 + 2 600 + 300 + 450 = **4 950** | 900 + 2 280 = 3 180 → **3 200** | |

CREW5 on the same cart → `min_not_met` ("Add $220.70 more to use CREW5"), no discount.

**V4 — shortage.** Boltbin accepts V3 with joist hangers 24 → 20 (`out_of_stock`): items 5 580 +
6 996 = 12 576; discount mulDivHalfUp(215, 20, 24) = 179 + 224 = 403; fee 0 (locked); taxable 12 173;
HST 1 582; current total **13 755**; released at capture 14 976 − 13 755 = **1 221 ($12.21)**. Order
current total 87 970. Reservation `reserved −= 4`; `stockOnHand` clamped to `reserved`.

**V5 — refund.** Scenario A's issue CASE-10001 (2 drywall sheets cracked, store at fault), after
capture: items 3 696; discount mulDivHalfUp(675, 2, 6) = 225; fee 0; HST percentBps(3 471) = 451;
refund **3 922 ($39.22)**. Payment → `partially_refunded`. Bluestone clawback −(3 696 − 370) = **−3 326**.

**V6 — pickup at Copperline (scenario C).** 4 × Copper pipe 3/4 in Type L 12 ft @ $96.98 + 6 × Ball
valve 1/2 in @ $18.98 = 50 180; no fees; HST 6 523; total **56 703 ($567.03)**.

**V7 — best-of rule.** Sam (first order), items $760.00 with BUILD25: promo 2 500 > welcome 2 000 →
BUILD25 `applied`, delivery still $0 (`first_order`). Same customer, items $400.00 with BUILD25 →
`min_not_met`, welcome $20 applies.

**V8 — driver pay.** Scenario D (Grainline → Leslieville, cargo van, 16.4 km, 207.0 kg, 10 pieces ≥
240 cm): 2 200 + 1 886 + 300 + 150 = 4 536 → **4 550**. Scenario E (Slatebridge → Mimico, pickup,
33.3 km, 624.0 kg, 20 heavy pieces): 1 600 + 3 330 + 1 100 + 300 = 6 330 → **6 350**. Quote Q-10002 Kestrel
store order (box truck, 14.9 km, 594.0 kg, 40 handling pieces): 4 000 + 2 235 + 1 000 + 600 = 7 835 →
**7 850**. Glassmoor mirror (car, 7.2 km): 900 + 540 = 1 440 → **1 450**. Wait pay: arrived 12:45,
`readyBy` 12:50, collected 13:20 → 30 min → 25 × 15 = **375**. Cancellation pay on a 4 775 offer:
ceilTo25(max(500, 1 194)) = **1 200**.

**V9 — unattended heavy load.** Scenario E delivered to an unattended site: load heavy (624 kg) →
labourer **required** (3 500, pickup class); taxable 127 956 + 3 500 = 131 456, HST 17 089, total
148 545 (attended: 144 590).

---

## 4. Time

### 4.1 Time zone (`time-zone.ts`, no `Intl`)

- `torontoOffsetMinutes(utcMs)`: −240 from the 2nd Sunday of March 07:00 UTC until the 1st Sunday of
  November 06:00 UTC, else −300 (computed with `Date.UTC` / `getUTCDay` only).
- `toLocal(utcMs) → { date: 'YYYY-MM-DD', weekday: Weekday, minutes: 0–1439 }`.
- `fromLocal(date, minutes) → utcMs`: a non-existent time (spring forward) resolves 60 min later;
  an ambiguous time (fall back) resolves to the first occurrence (EDT).
- `addLocalDays(date, n)`, `localDateOf(utcMs)`, `startOfLocalDay(date)`.
- **Vectors:** 2026-03-08T06:59:59Z → −300; 07:00:00Z → −240; 2026-11-01T05:59:59Z → −240;
  06:00:00Z → −300; 2027 switches 2027-03-14T07:00Z and 2027-11-07T06:00Z.
  `fromLocal('2026-03-08', 02:30)` = 07:30Z (03:30 EDT); `fromLocal('2026-11-01', 01:30)` = 05:30Z.
  Thu 2026-11-19 12:25 ET = 17:25Z.
- **Display:** `formatClockET(ms)` "1:40 pm"; `formatDayET(ms, now)` "Today" / "Tomorrow" / "Fri, Nov
  20"; `formatWindowET(start, end)` "7–9 am", "11 am–1 pm"; `formatDateTimeET`. Month and day names
  are hard-coded. These replace the device-locale `formatClock`/`formatDate` for business times.

### 4.2 Store hours, holidays, closures

- One interval per weekday (`hours[weekday]`, `close > open`, no overnight), store-specific
  `closures`, and the platform-wide **`ONTARIO_HOLIDAYS`** (no deliveries or pickups):
  2026-01-01, 2026-02-16, 2026-04-03, 2026-05-18, 2026-07-01, 2026-08-03, 2026-09-07, 2026-10-12,
  2026-12-25, 2026-12-26, 2026-12-28, 2027-01-01, 2027-02-15, 2027-03-26, 2027-05-24, 2027-07-01,
  2027-08-02, 2027-09-06, 2027-10-11, 2027-12-25, 2027-12-26, 2027-12-27, 2027-12-28.
- `storeHoursOn(store, date)` (null when closed), `isStoreOpenAt(store, ms)`, `nextOpeningAt(store, ms)`
  (searches 14 days).
- `LATEST_DROPOFF = 19:00` local: nothing is promised after 7 pm.

### 4.3 ASAP ("Delivery by 1:50 pm")

Per store order, with `now`, `prep = store.prepMinutes`, `load`/`drive` from §3.3:

1. Store live, accepting, offers delivery, open now (`isStoreOpenAt`), and `now < sameDayCutoff`
   ("Same-day cut-off was 3:00 pm").
2. `pickupAt = now + max(prep, 15)` (driver match and travel overlap preparation); `pickupAt +
   load ≤ close`.
3. `deliverBy = roundUp5(pickupAt + load + drive)`, same local date and ≤ 19:00.
4. `readyBy = now + prep`; `targetPickupAt = pickupAt`.

The order's ASAP window is valid only if every store passes; `endAt = max(deliverBy)`, label
"Today by 1:50 pm"; checkout also lists per-store promises ("Bluestone · by 1:40 pm"). Otherwise
ASAP is disabled with the first failing reason. Store cards and Home use the same function with
the cart's class for that store, or `pickup` by default.

### 4.4 Scheduled windows

- Slots (`DELIVERY_SLOTS`, 2 h each): Mon–Fri 07, 09, 11, 13, 15, 17 · Sat 08, 10, 12, 14 · Sun 10, 12,
  14. Horizon: today + 6 days (a product choice; card holds that end sooner are covered by the
  deadline capture, §3.8).
- A slot `[ws, we]` on date `d` is valid for a store when: the store has hours on `d` (not a holiday
  or closure) · `ws ≥ now + 90 min` · for today, `now < sameDayCutoff` · `earliest ≤ latest`, where
  `earliest = today ? max(open, now + prep) : open` (future-day orders are staged before opening)
  and `latest = min(close − load, we − load − drive)`.
- Derived: `targetPickupAt = clamp(ws − load − drive, earliest, latest)`; `readyBy = max(earliest,
  targetPickupAt − 15 min)`; `deliverBy = we`; `offerOpensAt = max(acceptedAt, targetPickupAt − 12 h)`.
- The order's slot list is the **intersection** over stores; invalid slots stay visible with the
  reason ("Kestrel and Bluestone are closed Sunday", "Bluestone closes at 1:00 pm Saturday", "Too
  soon — earliest 2:00 pm").

### 4.5 Pickup

- Ready time: if the store is open and `now + prep ≤ close − 15 min` → `readyAt = roundUp5(now +
  prep)`, else `roundUp5(nextOpening + prep)`. Labels "Ready in 15 min", "Ready tomorrow 7:15 am",
  "Ready Mon 7:15 am". No cut-off for pickup; no later-pickup scheduling in v1.
- `holdUntil` = closing time of the first open day strictly after `readyAt`'s date. After it,
  `expirePickupHolds` cancels the store order (not charged, stock released).

### 4.6 SLAs and job timing (constants in `fulfilment-time.ts`)

| Constant | Value | Effect |
| --- | --- | --- |
| `STORE_ACCEPT_SLA_MIN` | 10 | `respondBy = (open now ? now : nextOpeningAt) + 10 min` |
| `STORE_REMINDER_BEFORE_MIN` | 5 | push + SMS to the store's `alertPhone` at `respondBy − 5` |
| `STORE_AUTO_REJECT_AFTER_MIN` | 20 | staff alert at `respondBy` (`acceptOverdue`), auto-reject at `respondBy + 20` |
| `DISPATCH_BUFFER_MIN` | 15 | minimum lead before an ASAP pickup |
| `MIN_SCHEDULE_LEAD_MIN` | 90 | earliest scheduled slot start |
| `SCHEDULE_DAYS` | 7 | today + 6 |
| `OFFER_LEAD_MIN` | 720 | job offers open 12 h before target pickup (drivers can plan the next morning) |
| `JOB_UNCLAIMED_ALERT_MIN` | 15 | staff `job_unclaimed` after an offer is open this long (once, `nudgedAt`) |
| `QUOTE_SLA_MIN` | 30 | `respondBy = (in SUPPORT_HOURS ? now : next support opening) + 30 min` |
| `QUOTE_VALID_HOURS` | 24, 48 (default) or 72 | `offerValidUntil` |
| `ISSUE_WINDOW_HOURS` | 48 | after `completedAt` |
| `ISSUE_SLA_HOURS` | 4 | `slaDueAt` (support hours not applied in v1) |
| `CAPTURE_DEADLINE_DAYS` | 6 | deadline capture at `min(authorizedAt + 6 days, captureBefore − 6 h)` |

### 4.7 Server rules

- The server is the clock: callables use `Date.now()` with these helpers; `placeOrder` and
  `acceptQuote` re-run `resolveWindow(windowId, stores, now)` and fail `WINDOW_UNAVAILABLE` with
  fresh windows in `details.windows`. Window ids: `asap` or `YYYY-MM-DDTHH:MM` (slot start).
- Scheduled functions declare `timeZone: 'America/Toronto'`. No server code calls `getHours()`.
- `storeOrders.timing.readyByDate` holds the local date for "today" boards; ledger `runKey` and
  `periodDate` are local dates.

### 4.8 Worked examples (Thu 2026-11-19, EST)

- **ASAP at 12:25** for V1: Bluestone prep 20, 22.9 km → drive 37 min (pickup class 38 km/h):
  pickup 12:45, deliver by 13:37 → **1:40 pm**. Kestrel prep 25, 26.0 km → drive 42 min: pickup
  12:50, deliver by 13:47 → **1:50 pm**. Order: "Today by 1:50 pm". `respondBy` 12:35 (reminder
  12:30, staff alert 12:35, auto-reject 12:55). Offers open at acceptance.
- **At 15:10** (after both 15:00 cut-offs): ASAP off, today's slots off. Friday's six slots are all
  valid: 07–09 → target pickup 06:30 at both stores (opening), offers open Thu 6:30 pm; 09–11 →
  Kestrel pickup 08:03 (`readyBy` 07:48), Bluestone 08:08 (07:53); 17–19 → Kestrel 16:03, Bluestone
  16:08. Saturday: 08–10 → 07:03 / 07:08; 14–16 → Kestrel 13:03, Bluestone 12:45 (loading must end
  before its 13:00 close). Sunday: none ("Kestrel and Bluestone are closed Sunday").
- **Pickup at Copperline** (prep 15, Mon–Fri 07:00–17:00, Sat 08:00–14:00): ordered 12:25 → ready
  12:40 ("Ready in 15 min"), hold until **Fri 5:00 pm**; ordered 16:50 → ready **Fri 7:15 am**, hold
  until **Sat 2:00 pm**.

---

## 5. Backend: callables, triggers, schedules

### 5.1 Module layout (`firebase/functions/src`, one owner per folder, §14)

```
index.ts                     root exports only: one `export * from './modules/<m>'` per module barrel (B)
config/runtime.ts            + paymentsMode 'test'|'stripe'|'disabled', allowTestJobs, hstNumber (B)
lib/                         admin, errors (+failCode), functions, guards (+supplier/driver), ids (+peekSequenceInTx,
                             isRequestId), users, rate-limit.ts (B)
modules/commerce/            register-customer, place-order, cancel-order, order-writer.ts (stageMarketplaceOrder),
                             checkout-context.ts, order-aggregate.ts (syncOrderAggregate)  (B)
modules/payments/            gateway.ts, test-gateway.ts, payment-service.ts (authorize/void/finalize/refund), capture-sweep.ts (B)
modules/stores/              accept/update/reject store order, complete-pickup, transitions.ts (stageStoreOrderTransition),
                             stock.ts, pickup-code.ts, driver-projection.ts, store-admin.ts (createStore, updateStoreSettings,
                             updateStoreProfile), on-store-order-written, on-product-written, on-store-written, reviews,
                             scheduled.ts (escalateStoreOrders, expirePickupHolds)  (C)
modules/auth/                phone-otp.ts (B) · staff.ts, supplier-users.ts (C) · register-driver.ts, driver-status.ts,
                             driver-vehicle.ts (D)
modules/deliveries/          delivery-writer (+stageMarketplaceDelivery, stageDeliveryCancellation), update-status,
                             assign-delivery, create-deliveries, check-in, resolve-failed, on-delivery-written, repository (D)
modules/jobs/                offers.ts (stageJobOffer, deleteJobOffer, audience), claim-job, boost (P1),
                             publish-due-offers, on-job-offer-written (D)
modules/routing/, tracking/, geocoding/, sms/, maintenance/ (+run-job-now)  (D)
modules/quotes/, issues/, support/, suggestions/, payouts/, notifications/, chat/  (E)
```

Every module has an `index.ts` barrel created on day 1 (§14.3). A module never edits another
module's files; it imports the helpers below.

### 5.2 Cross-module helpers (signatures frozen on day 1; stubs throw `not implemented`)

Firestore transactions need all reads before writes, so **`stage*` helpers never read**: callers
read the documents in their read phase and pass the snapshots in.

```ts
// lib (B)
requireSupplier(req): Actor & { storeId: string; storeRole: StoreRole }      // active supplier
requireStoreAccess(actor: Actor, storeId: string, opts?: { ownerOnly?: boolean }): void  // staff or member
requireActiveDriver(req): Actor & { cityId: CityId; capacityClass: VehicleClass }
peekSequenceInTx(tx, counter: 'deliveries' | 'quotes' | 'issues'): Promise<{ value: number; stage(): void }>
consumeRateLimit(bucket: string, subject: string, max: number, windowSeconds: number): Promise<void> // throws RATE_LIMITED
failCode(code: ErrorCode, message: string, details?: Record<string, unknown>): never
isRequestId(value: unknown): value is string                                  // UUIDv4

// commerce (B)
loadCheckoutContext(input: CheckoutContextInput): Promise<CheckoutContext>    // reads outside the transaction
stageMarketplaceOrder(tx, plan: MarketplaceOrderPlan): StagedOrder            // placeOrder, acceptQuote, replacements
syncOrderAggregate(orderId: string, eventId: string): Promise<void>           // called by onStoreOrderWritten
// payments (B)
authorizeOrderPayment(orderId, amountCents, customerId, card): Promise<{ intentRef: string; captureBefore: number }>   // throws CARD_DECLINED
voidOrderAuthorization(orderId, intentRef): Promise<void>                    // callers first check that orders/{orderId} doesn't exist
finalizeOrderPayment(orderId: string, opts?: { deadline?: boolean }): Promise<void>
refundOrderPayment(i: { orderId; storeOrderId; amountCents; reason; idempotencyKey; issueId: string | null }): Promise<{ ref: string }>

// stores (C)
stageStoreOrderTransition(tx, so: StoreOrderRecord, to: StoreOrderStatus, actor: OrderActor,
  opts?: { adjustments?: LineAdjustment[]; reason?: string; note?: string; extra?: Record<string, unknown> }): StoreOrderRecord
stageStockReserve(tx, products: ProductSnap[], lines), stageStockRelease(tx, products, lines, { outOfStock: boolean }),
stageStockCommit(tx, products, lines)
stagePickupCode(tx, storeOrderId: string, issuedTo: 'customer' | string): string   // new 4-digit PIN, attempts reset
projectDriverOntoStoreOrder(before: DeliveryRecord | null, after: DeliveryRecord): Promise<void>

// deliveries & jobs (D)
stageMarketplaceDelivery(tx, input: MarketplaceDeliveryInput): { deliveryId: string; trackingToken: string }
stageDeliveryCancellation(tx, delivery: DeliveryRecord, actor: EventActor, reason: string): void  // + deletes the offer
stageJobOffer(tx, delivery: DeliveryRecord, opts: { opensAt: number; now: number }): void
deleteJobOffer(tx, deliveryId: string): void

// payouts & notifications (E)
recordStoreOrderLedger(orderId: string): Promise<void>
recordDeliveryLedger(before: DeliveryRecord | null, after: DeliveryRecord): Promise<void>
recordClawback(i: { issueId; payeeType; payeeId; amountCents; description }): Promise<void>
notifyStoreMembers(storeId: string, input: NotificationInput, opts?: { ownersOnly?: boolean }): Promise<void>
notifyDrivers(driverIds: string[], input: NotificationInput): Promise<void>
```

### 5.3 Callable contracts (`packages/shared/src/api.ts`)

```ts
// customer
interface RegisterCustomerRequest { displayName: string; companyName?: string | null; accountType?: AccountType | null; marketingOptIn?: boolean }
interface PlaceOrderRequest { checkoutId: string; items: CartLine[]; fulfilment: Fulfilment; jobsiteId: string | null;
  windowId: string | null; receiving: Receiving | null; siteContact: Contact | null; instructions: string | null;
  unloadHelpStoreIds: string[]; cardId: string; promoCode: string | null; expectedTotalCents: number }
interface PlaceOrderResponse { orderId: string; number: string; totalCents: number; storeOrders: { storeOrderId: string; number: string; storeId: string }[] }
interface CancelOrderRequest { orderId: string; storeOrderIds?: string[] | null; reason?: string | null }
interface CancelOrderResponse { cancelled: string[]; notCancellable: { storeOrderId: string; status: StoreOrderStatus }[] }
// supplier
interface LineAdjustment { lineId: string; fulfilledQty: number; reason: ShortReason }
interface AcceptStoreOrderRequest { storeOrderId: string; expectedVersion: number; adjustments?: LineAdjustment[]; note?: string | null }
interface UpdateStoreOrderStatusRequest { storeOrderId: string; expectedVersion: number; status: 'preparing' | 'ready';
  adjustments?: LineAdjustment[]; note?: string | null }
interface RejectStoreOrderRequest { storeOrderId: string; expectedVersion: number; reason: StoreRejectReason; note?: string | null }
interface StoreOrderActionResponse { status: StoreOrderStatus; version: number }
interface CompletePickupRequest { storeOrderId: string; expectedVersion: number; pickupCode: string | null;
  adjustments?: LineAdjustment[]; overrideReason?: string | null /* staff only: skips the PIN */ }
interface CompletePickupResponse { status: 'out_for_delivery' | 'picked_up' }
type StoreProfilePatch = Partial<Pick<Store, 'description' | 'phone' | 'email' | 'hours' | 'closures'
  | 'prepMinutes' | 'sameDayCutoff' | 'acceptingOrders'>> & { fulfilment?: { delivery?: boolean; pickup?: boolean };
  photoPath?: string | null /* 'storePhotos/{storeId}/…'; the server sets photoUrl */;
  loadingNotes?: string | null /* saved to private/settings */; alertPhone?: string | null /* saved to private/settings */ };
interface UpdateStoreProfileRequest { storeId: string; patch: StoreProfilePatch }
interface CreateStoreRequest { storeId: string; store: Omit<Store, 'id' | 'rating' | 'ratingCount' | 'createdAt' | 'updatedAt'>; settings: StorePrivateSettings }
interface UpdateStoreSettingsRequest { storeId: string; store?: Partial<Pick<Store, 'name' | 'specialty' | 'categoryIds' | 'description'
  | 'address' | 'location' | 'cityId' | 'areaLabel' | 'status'>> & { deliveryRadiusKm?: number }; settings?: Partial<StorePrivateSettings> }
interface InviteSupplierUserRequest { storeId: string; email: string; displayName: string; storeRole: StoreRole }
interface InviteSupplierUserResponse { uid: string; passwordSetupLink: string }
interface SetSupplierUserStatusRequest { uid: string; status: 'active' | 'suspended'; reason?: string | null }
// driver
interface DriverVehicleInput { type: VehicleType; make: string; model: string; year: number; plate: string; colour: string | null;
  boxLengthFt: 5.5 | 6.5 | 8 | null; payloadKg: number | null; extras: VehicleExtra[] }
interface RegisterDriverRequest { displayName: string; cityId: CityId; vehicle: DriverVehicleInput;
  attestations: { licence: true; insurance: true; terms: true } }
interface UpdateDriverVehicleRequest { vehicle: DriverVehicleInput }
interface ReviewDriverVehicleRequest { uid: string; approve: boolean; capacityClass?: VehicleClass | null; note?: string | null }
interface SetDriverStatusRequest { uid: string; status: 'active' | 'suspended'; reason?: string | null; capacityClass?: VehicleClass | null;
  licenceVerified?: boolean; insuranceVerified?: boolean; force?: boolean /* emulator only */ }
interface ClaimJobRequest { deliveryId: string }  →  { deliveryId: string; status: 'accepted' }
interface CheckInAtStoreRequest { deliveryId: string; location?: LatLng | null }
interface AssignDeliveryRequest { deliveryId: string; driverId: string | null; note?: string | null; force?: boolean }
interface ResolveFailedDeliveryRequest { storeOrderId: string; action: 'reattempt' | 'return_to_store'; windowId?: string | null;
  refundDeliveryFee?: boolean; note?: string | null }
interface BoostJobPayoutRequest { deliveryId: string; addCents: 500 | 1000 | 1500 | 2000 }   // P1
// UpdateDeliveryStatusRequest unchanged (declineReason doubles as the release reason); CompleteDeliveryRequest loses codCollected.
// quotes
interface SubmitMaterialListRequest { requestId: string; lines: { text: string; quantity: number | null }[]; attachments: QuoteAttachment[];
  neededBy: QuoteRequest['neededBy']; fulfilment: Fulfilment; jobsiteId: string | null; contact: QuoteRequest['contact']; notes: string | null }
interface SubmitMaterialListResponse { quoteId: string; number: string; respondBy: number /* epoch ms */ }
type QuoteLineInput =
  | { kind: 'catalog'; productId: string; quantity: number; unitPriceCents: number | null /* null = list */; note: string | null; requestLine: number | null }
  | { kind: 'custom'; storeId: string; name: string; unit: SellUnit; size: string | null; quantity: number; unitPriceCents: number;
      weightKg: number; dimsCm: DimsCm; note: string | null; requestLine: number | null };
interface SendQuoteRequest { quoteId: string; expectedVersion: number /* current offer version, 0 if none */; lines: QuoteLineInput[];
  unmatched: { requestLine: number; text: string; reason: string }[]; fulfilment: Fulfilment; receiving: Receiving | null;
  windowId: string | null; unloadHelpStoreIds: string[]; message: string | null; validHours: 24 | 48 | 72 }
interface AcceptQuoteRequest { quoteId: string; version: number; checkoutId: string; cardId: string; windowId: string | null;
  receiving: Receiving | null; siteContact: Contact | null; instructions: string | null; unloadHelpStoreIds?: string[]; expectedTotalCents: number }
interface CloseQuoteRequest { quoteId: string; reason?: string | null }
interface ReopenQuoteRequest { quoteId: string; message: string | null }
// issues
interface ReportIssueRequest { issueId: string; storeOrderId: string; type: IssueType; lines: { lineId: string; quantity: number }[];
  description: string; photoPaths: string[]; preferredResolution: 'replacement' | 'refund' | 'return' }
interface ReportIssueResponse { issueId: string; number: string }
interface ResolveIssueRequest { issueId: string; kind: 'refund' | 'replacement' | 'no_action'; lines?: { lineId: string; quantity: number }[];
  refundDeliveryFee?: boolean; returnRequired?: boolean; faultParty: FaultParty | null; note: string }
interface ResolveIssueResponse { refundCents: number; replacementOrderId: string | null }
// misc
interface SuggestStoreRequest { storeName: string; city: string; interests: string[]; email: string | null }
interface GeocodeAddressResponse { results: { label: string; location: LatLng; line1: string | null; city: string | null;
  postalCode: string | null; cityId: CityId; areaLabel: string }[] }
type ScheduledJobName = 'escalateStoreOrders' | 'expirePickupHolds' | 'publishDueJobOffers' | 'markStaleDriversOffline'
  | 'expireQuotes' | 'runDailyPayouts' | 'captureDuePayments';
interface RunJobNowRequest { job: ScheduledJobName; now?: number | null }  →  { job; now: number; result: Record<string, number> }
```

`CALLABLES` gains every new name above. Each callable uses the existing `callable()` wrapper
(sanitized errors) and the shared validators.

### 5.4 Callables

| Callable | Caller | Validation | Writes (one transaction unless noted) | Afterwards |
| --- | --- | --- | --- | --- |
| `registerCustomer` (ext.) | new user | name 1–80, company ≤ 80, account type | profile with `stats {0,0,null}`, `promoUses {}`, `preferences.promoPush = marketingOptIn` | claim `customer` |
| `placeOrder` (rewrite) | active customer | §5.5.1 | §5.5.1 | customer `order_placed`; stores via trigger; staff silent |
| `cancelOrder` (ext.) | the customer | targets default to all store orders; each must allow `→ cancelled` for `customer` (new, accepted) | per target: `stageStoreOrderTransition(cancelled)`, stock release, `stageDeliveryCancellation`; returns both lists; none cancellable → `failed-precondition` | stores and claimed drivers notified via triggers |
| `acceptStoreOrder` | member, staff | `expectedVersion` (`VERSION_CONFLICT`), table, adjustments | store order, stock, delivery `offerOpensAt`/`offerStatus`, `stageJobOffer` | customer (with shortage text) via trigger; drivers via `onJobOfferWritten` |
| `updateStoreOrderStatus` | member, staff | version, table, adjustments | store order; ready: `pickup.readyAt`, delivery `pickup.ready/readyAt`, offer `pickup.ready`; pickup: `holdUntil` | driver `job_update` "IS-10042-B is ready at Kestrel"; customer PIN for pickups |
| `rejectStoreOrder` | member, staff | version, table, reason | void amounts, stock release (+ clamp on `out_of_stock`), `stageDeliveryCancellation` | customer "won't be charged $X"; driver cancelled; staff alert |
| `completePickup` | member, staff | §5.5.2 | §5.5.2 | customer "On the way" / "Picked up" |
| `updateStoreProfile` | owner (all patch fields), any member (`acceptingOrders` only), staff | `validateStoreProfile` (hours, closures ≤ 60 future dates, prep 5–240, cutoff, NANP phone and `alertPhone`); `photoPath` must exist under `storePhotos/{storeId}/` | store (`photoUrl` from the Admin SDK `getDownloadURL`); `loadingNotes`, `alertPhone` to `private/settings` | `onStoreWritten` fan-out; staff notified when a store pauses |
| `createStore` / `updateStoreSettings` | admin | slug unique; `isValidStore`; radius 1–60; commission 0–3 000 bps | store + `private/settings` | product fan-out when name/status change |
| `inviteSupplierUser` | staff (any store, any role); owner (own store, `staff` only) | email not used by another account | Auth user, claims `{role:'supplier', active:true, storeId, storeRole}`, profile | returns `passwordSetupLink` (like `createStaffUser`) |
| `setSupplierUserStatus` | staff, owner (own store, not self) | same store | claims `active`, Auth disabled flag, profile status | tokens revoked on suspend |
| `registerDriver` (ext.) | signed-in user with no other role (staff, customer and supplier accounts are refused, like `registerCustomer` refuses non-customers) | name, city, vehicle (`validateDriverVehicle`: year 1995–next year, plate 2–10, box size required for pickups), attestations all true | pending profile, `vehicle` with derived `capacityClass`, `compliance` attest times | claims `{role:'driver', active:false}`; admins `driver_signup` |
| `updateDriverVehicle` | driver | same validator | `vehicleDraft`, `vehicleReviewRequired: true` | admins `vehicle_review` |
| `reviewDriverVehicle` | admin | draft exists | approve: `vehicle = draft` (+ override class), clear draft; reject: clear draft | claims `capacityClass`; driver `vehicle_review` |
| `setDriverStatus` (ext.) | admin | approval needs both compliance checks (or `force` in the emulator) | profile status, compliance flags, optional class override; on suspension, each uncollected marketplace delivery of the driver is released in its own transaction (offer re-created, §2.4) | claims `{role, active, cityId, capacityClass}`; driver notified; staff alerted about the driver's collected deliveries |
| `claimJob` | active driver | §5.5.3 | §5.5.3 | stores see the driver via projection; route re-plan |
| `checkInAtStore` | assigned driver | delivery `accepted`, pickup not collected | `pickup.arrivedAt` (once), event | store "Marco is at the counter for IS-10042-B — ask for his PIN" |
| `updateDeliveryStatus` (ext.) | driver, staff | §2.3 rules; release needs a decline reason | delivery (+ re-created offer on release/decline; store order `failed` on failure) | as today |
| `completeDelivery` (ext.) | driver, staff | marketplace driver: `photoPath` of an object that exists under `proofs/{deliveryId}/` (checked with the Admin SDK before the transaction; `PHOTO_REQUIRED`), code when `requireCode` (5 attempts, as today) | delivery `delivered` + proof; store order `delivered` | customer "Delivered — see the drop-off photo" |
| `assignDelivery` (ext.) | staff | marketplace: status ∈ unassigned/assigned/accepted; `canCarry` unless `force` (`VEHICLE_TOO_SMALL`) | delivery (`offerStatus: 'claimed'`), `deleteJobOffer`, `stagePickupCode`; unassign clears the PIN and re-creates the offer (§2.4) | as today |
| `resolveFailedDelivery` | staff | store order `failed` | reattempt: delivery `failed → picked_up`, `attempts + 1`, optional window; store order `→ out_for_delivery`. Return: delivery `→ cancelled`; store order `→ cancelled`; `stockOnHand += fulfilledQty`; `current` = fees only when the failure was site-caused and `refundDeliveryFee` is false, else void | customer and driver notified |
| `createDeliveries`, `optimizeRoute` | staff (`optimizeRoute` also a driver for their own route, as today) | COD removed from `DeliveryInput` | unchanged (`kind: 'manual'`; plans now include pickup stops, §5.11) | unchanged |
| `boostJobPayout` (P1) | staff | offer open or scheduled | `payout.boostCents/totalCents`, offer `payoutCents` | drivers re-notified |
| `submitMaterialList` | customer | §5.5.6 | quote `submitted` | staff `quote_new`; customer confirmation (silent) |
| `sendQuote` | staff | §5.5.6 | `offer` (version + 1), `offerValidUntil`, `offerHistory`, status `quoted` | customer `quote_update`; SMS when the preference is call or WhatsApp |
| `acceptQuote` | the customer | §5.5.6 | order via `stageMarketplaceOrder(source 'quote')`; quote `accepted` | as `placeOrder` |
| `closeQuote` | customer (→ declined), staff (→ cancelled) | not final | status, `closeReason` | other side notified |
| `reopenQuote` | the customer | quoted or expired | `in_review`, message posted to the support thread with quote context | staff `quote_new` |
| `reportIssue` | the customer | §5.5.7 | issue `open`, store order `issueCount + 1`, ledger hold | staff `issue_new`; store `store_issue` |
| `resolveIssue` | staff | §5.5.7 | resolution, refund or credit, clawback, replacement order | customer `issue_update`; store when at fault |
| `suggestStore` | anyone (App Check when enforced) | name 2–80, city 2–60, ≤ 12 interests from the list, optional email; 5/hour per uid, or per `hmac(ip)` for guests (§1.1; IP = first `x-forwarded-for` address) | suggestion `new` | staff `store_suggestion` (silent) |
| `geocodeAddress` (ext.) | anyone | ≥ 3 chars; non-staff 30/hour per uid or `hmac(ip)`; apps search on submit, never per keystroke (Nominatim's usage policy forbids autocomplete) | — | GTA-biased results (Google `components=country:CA` + `SERVICE_AREA` bounds; Nominatim `countrycodes=ca` + bounded viewbox) with `cityId`, `areaLabel`, `postalCode` |
| `runJobNow` | admin, only when `ALLOW_TEST_JOBS=true` (emulator default) | known job | runs the job body with `now` (time travel for tests and the seed) | returns counts |

Unchanged: `requestPhoneOtp`/`verifyPhoneOtp` (now +1 via shared `normalizePhone`),
`createStaffUser`, `sendTestNotification`.

### 5.5 Detailed flows

#### 5.5.1 `placeOrder`

1. `requireCustomer`; `paymentsMode === 'disabled'` → `PAYMENTS_DISABLED`. Validate: `isRequestId(checkoutId)`;
   items merged by product, 1–100 lines, quantity 1–9 999, every `storeId` matches its product;
   `windowId` format; `receiving`; `siteContact` NANP; instructions ≤ 500; `unloadHelpStoreIds` ⊆ cart
   stores; `expectedTotalCents` integer.
2. **Idempotency:** `orders/{checkoutId}` exists → return it if `customerId === uid`, else `already-exists`.
   The transaction (step 5) reads `orders/{checkoutId}` again and, if a concurrent call created it,
   writes nothing and returns it; the authorization is then left alone (§3.8 void rule).
3. **Read outside the transaction** (`loadCheckoutContext`): profile (`phoneVerified` else
   `PHONE_UNVERIFIED`), jobsite (delivery: required, pin inside `SERVICE_AREA` else
   `OUTSIDE_SERVICE_AREA`), card (exists, future expiry), products (`getAll`), stores and their
   `private/settings`. Build pricing lines; `priceCheckout`; window: `resolveWindow` (delivery) or
   `pickupReady` per store (pickup). Checks: every product `active && listed`; `qty ≤ availableQty` and
   `≤ maxPerOrder` (`OUT_OF_STOCK { productId, available }`); `canPlace` (else the first blocker's code);
   `total === expectedTotalCents` (else `PRICE_CHANGED { pricing }`).
4. **Authorize** the total (`auth_{orderId}`); decline → `CARD_DECLINED`.
5. **Transaction** (`stageMarketplaceOrder`): re-read profile, products, stores, counter; re-validate
   stock and store status; re-price with the re-read `isFirstOrder` (a concurrent first order makes the
   second one re-price → `PRICE_CHANGED`, and the authorization is voided). Writes:
   - `counters/deliveries` (+1) → `IS-{n}`;
   - per store, in letter order: `storeOrders/{orderId}-{L}` (`new`, lines with allocated discounts,
     `placed = current`, `timing`, `load`, `unload`, history `created`), `private/meta`
     (`commissionBps`; pickup fulfilment: `pickupCode` issued to the customer; delivery: none until a
     driver is assigned), and for delivery `stageMarketplaceDelivery` (delivery `unassigned`,
     `offerStatus: 'held'`, pickup block, load, payout offer, `unload`, `receiving`, `requireCode`,
     `requirePhoto: true`, window, `priority`, `cityIds`; private meta with tracking token and hand-off
     code; tracking doc; events);
   - products: `reserved += quantity` (catalog lines);
   - `orders/{orderId}` (snapshots, `placed`, `current`, payment `authorized` with an `authorize`
     event, `storeOrders[]` summaries, `status: 'placed'`, `isFirstOrder`, `countsTowardFirstOrder`,
     `hstNumber` from config);
   - profile: `stats.nonCancelledOrders + 1`, `lastOrderAt`, `promoUses[code] + 1` when a promo applied;
     jobsite `lastUsedAt`.
   At most 1 + 1 + 1 + 1 + 6 × 5 + 100 = 134 writes.
6. After commit: notifications; return `PlaceOrderResponse`.

#### 5.5.2 `completePickup` (the store confirms a collection with the PIN)

Reads: store order, `private/meta`, the delivery (delivery fulfilment), catalog products. Checks:
caller is staff or a member of the store; `expectedVersion` (`VERSION_CONFLICT`); adjustments (if any)
applied first; status `ready`; delivery fulfilment: delivery `accepted` with a driver
(`DRIVER_NOT_ASSIGNED` "Marco hasn't accepted the job yet") and `meta.pickupCodeIssuedTo ===
delivery.driverId` (a released driver's PIN never works); PIN unless a staff `overrideReason`:
`codeAttempts ≥ 5` → `CODE_LOCKED` (only staff can complete); wrong PIN → `codeAttempts + 1`
committed and `CODE_INCORRECT { remaining }` returned after the transaction (same pattern as today's
hand-off code). Writes: store order →
`out_for_delivery` (delivery) or `picked_up` (pickup, `completedAt`), `pickup.collectedAt`,
`collectedBy`, history; meta attempts reset; delivery → `picked_up` (`pickedUpAt`,
`pickup.collectedAt`, `payout.waitCents` §3.10, event "Collected at Kestrel Lumber Yard — PIN
checked by Owen M." with the store member as actor, `actorRole: 'supplier'`; a staff override records
the staff member and the reason); stock commit `stockOnHand = max(0, stockOnHand − fulfilledQty)`,
`reserved −= fulfilledQty`. Stock helpers skip catalog products that no longer exist (deleted after
an earlier hand-over) instead of failing the transaction; this matters for the restock of a
`return_to_store`.

#### 5.5.3 `claimJob`

Reads: the offer, the delivery, the driver profile, `driverLocations/{uid}`, the driver's active
deliveries (`driverId == uid`, status in `ACTIVE_STATUSES`), the store order's `private/meta`.
Checks: offer exists and `open`, delivery `unassigned` (else `OFFER_TAKEN` "Someone else just took
this job"); `"{cityId}:{capacityClass}"` ∈ `audience` (else `VEHICLE_TOO_SMALL` or `permission-denied`
for another city); while the profile has `vehicleReviewRequired`, the job's class must also fit
`capacityClassFor(vehicleDraft)` (`VEHICLE_TOO_SMALL`); fewer than 4 active jobs (`TOO_MANY_JOBS`); not
released by this driver in the last 60 min (`RELEASED_RECENTLY`); when target pickup is within 2 h,
location updated in the last 10 min and `online` (`DRIVER_OFFLINE`). Writes: delivery `driverId`,
`driverName`, `status: 'accepted'`, `assignedAt`, `acceptedAt`, `offerStatus: 'claimed'`,
`pickup.pickupCode = stagePickupCode(...)`, events `assigned` ("Claimed from the job board") and
`status` with the driver as actor; `deleteJobOffer`. Two concurrent claims: transaction contention
guarantees exactly one wins.

#### 5.5.4 `updateDeliveryStatus` / `completeDelivery` coupling

Both read the store order when `storeOrderId` is set and call `stageStoreOrderTransition` in the
same transaction: `failed` → store order `failed`; `delivered` → `delivered`. A release or decline
clears `pickup.pickupCode` and calls `stageJobOffer` with the §2.4 re-creation rule (or sets
`offerStatus: 'held'` while the store order is still `new`). Staff `cancelled`/`picked_up` on
marketplace deliveries are refused with a pointer to the store-order actions.

#### 5.5.5 `syncOrderAggregate(orderId, eventId)` (from `onStoreOrderWritten`)

Transaction: read the order and all its store orders; rebuild `storeOrders[]` (carrying
`trackingToken` and `pickupCode` over from the existing summaries — they are not on the store order
documents), `current`, `status`, `statusAt`, `needsAttention`, `completedAt`; `stats.completedOrders + 1`
when the order first becomes `completed`. If the status becomes `cancelled` and
`countsTowardFirstOrder` → profile `stats.nonCancelledOrders − 1`, `promoUses[code] − 1`, flag false.
After the transaction: settled and payment `authorized` → `finalizeOrderPayment`; payment already
captured and a store order's `current.totalCents` below `capturedByStoreOrder[id] −
adjustedByStoreOrder[id]` → `refundOrderPayment` for the difference
(`refund_adj_{storeOrderId}_v{version}`, §3.8); order-level customer messages ("Order complete ·
charged $879.70"). Idempotent: it always recomputes from current documents.

#### 5.5.6 Quotes

- `submitMaterialList`: `isRequestId(requestId)` (doc id; retry returns the same quote); lines 0–60
  (text 2–120, quantity null or 1–99 999); attachments 0–5 under `quoteUploads/{uid}/{requestId}/`,
  each verified through Storage metadata (exists, ≤ 15 MB, allowed type); at least one line or file;
  delivery needs a jobsite; contact: a verified phone, or an email when the preference is email; 10 per
  day. Writes `Q-{n}`, `status: 'submitted'`, `respondBy` (§4.6).
- `sendQuote`: `expectedVersion` must equal the current offer version (`QUOTE_VERSION`); ≤ 100 lines,
  quantity 1–9 999; catalog lines must be listed and live (`unitPriceCents` override 1–10 000 000,
  `listPriceCents` recorded; an override is a price the store agreed to, and the store is paid the
  quoted price through `storeValueCents`); custom lines need a live store, name, unit, price, weight
  and size; price with `priceCheckout({ source: 'quote', customer: current isFirstOrder })`; no blockers;
  `resolveWindow` when `windowId` is given. Writes the offer (version + 1), `offerValidUntil = now +
  validHours`, `offerHistory` entry, `status: 'quoted'`.
- `acceptQuote`: quote `quoted`, `version` matches (`QUOTE_VERSION`), not past `offerValidUntil`
  (`QUOTE_EXPIRED`); window = request's `windowId` or the offer's, re-resolved; catalog lines
  re-checked for stock (custom lines do not reserve stock; the store confirmed them offline); re-price at
  the quoted unit prices with the current `isFirstOrder` → `PRICE_CHANGED` on mismatch; authorize;
  `stageMarketplaceOrder(source: 'quote', quoteId)` and quote → `accepted` with `orderId` in the same
  transaction.

#### 5.5.7 Issues

- `reportIssue`: `isRequestId(issueId)`; store order owned by the caller, `delivered` or `picked_up`,
  `completedAt` within 48 h (`ISSUE_WINDOW_CLOSED`), no open issue on it (`ISSUE_ALREADY_OPEN`); lines
  ⊆ its lines with `quantity ≤ fulfilledQty`; description 10–1 000; photos 0–6 under
  `issuePhotos/{issueId}/`, each verified through Storage metadata (exists, image, ≤ 10 MB,
  `ownerUid` = caller), ≥ 1 for `damaged` and `wrong_item`; 10 per day. Writes `CASE-{n}`,
  `slaDueAt = now + 4 h`, store order `issueCount + 1`, and `heldForIssueId` on that store order's
  unpaid ledger entries.
- `resolveIssue`: staff; issue `open` or `in_review`. **Refund:** amounts from `refundForLines`;
  dispatcher cap $100 (`REFUND_LIMIT`). If the order's payment is captured → `refundOrderPayment`
  (`refund_{issueId}`) and `recordClawback` per fault. If not yet captured → the store order's
  `current` is reduced component-wise by the refund (the customer is simply not charged) and, when the
  store is at fault, `storeValueCents` is reduced by the refunded gross items (so the later sale entry is
  smaller); a driver at fault still gets a clawback entry. **Replacement:** `stageMarketplaceOrder` with
  `source: 'replacement'`, the issue's lines at 0, same store, jobsite and fulfilment, window ASAP or
  the earliest, payment `not_required`; ledger per §3.9. **No action:** note only. Always: release
  ledger holds, notify.

### 5.6 Triggers

| Trigger | Path | Owner | Does |
| --- | --- | --- | --- |
| `onStoreOrderWritten` | `storeOrders/{id}` | C | create → store `store_order_new` ("New order IS-10042-B · 2 items · Delivery by 1:50 pm") plus an SMS to the store's `alertPhone` when set (the portal may be closed; purpose `store_alert`, dev outbox in the emulator; sent once through a marker in `private/meta`, like today's tracking-link SMS); status change → customer message (§5.8) and store messages for customer cancellations; driver projection change → store `store_order_update` ("Marco (Ford F-150 · CBKX 214) is heading to you"); always `syncOrderAggregate` (B). Keys `{eventId}-…`. |
| `onDeliveryWritten` | `deliveries/{id}` | D | existing route re-plan, tracking sync (now with `phase`, `pickup`, `deliverBy`), driver/staff notifications, tracking SMS to the site contact at `in_transit`; plus `projectDriverOntoStoreOrder` (C), `recordDeliveryLedger` (E), customer heads-up at `arrived` (attended: "Marco is at your site — have the hand-off code ready"; unattended: "Marco is at your site"). Route stops and ETAs per §5.11. Removes `syncOrderFromDelivery`. |
| `onJobOfferWritten` | `jobOffers/{deliveryId}` | D | when an offer becomes `open`: notify up to 20 active, online drivers whose `"{cityId}:{capacityClass}"` is in the offer's `audience` (so the jobsite's max vehicle is respected) (`job_offer`, key `offer-{deliveryId}-{openedAt}`). |
| `onProductWritten` | `products/{id}` | C | `searchTerms = buildSearchTerms(name, [brand, sku, size, category name + synonyms, familyKey])`, `listed = active && store.status === 'live'`, `storeName`, `storeStatus`, `imageUrl` = Admin SDK `getDownloadURL(imagePath)` (null without a path); writes only when something changed (no loop). |
| `onStoreWritten` | `stores/{id}` | C | name or status changed → update `storeName/storeStatus/listed` on its products in pages of 400. |
| `onStoreReviewWritten` | `stores/{id}/reviews/{storeOrderId}` | C | `rating` (1 decimal) and `ratingCount` via aggregate query; store order `rated = true`. Replaces `onReviewWritten`. |
| `onSupportMessageCreated` | `supportThreads/{t}/messages/{m}` | E | thread summary and unread counters (creates the thread on first message); inbound → staff `support_message`; staff reply → the customer or every active member of the store (`support_reply`). Key `support-{m}`. |
| `onNotificationCreated` | `notifications/{id}` | E | unchanged, plus channels and preferences (§5.8). |
| `onChatMessageCreated`, `onDriverLocationWritten` | as today | E, D | unchanged (P1: `etaToStoreAt` refresh on the store order for `accepted` jobs). |

### 5.7 Scheduled jobs (all `timeZone: 'America/Toronto'`; each body is `runX(now)` so `runJobNow` can call it)

| Job | Schedule | Owner | Does |
| --- | --- | --- | --- |
| `escalateStoreOrders` | every 5 min | C | `new` store orders: reminder at `respondBy − 5` (push + SMS, `reminderSentAt`), `acceptOverdue` + staff `store_order_late` at `respondBy`, auto-reject `no_response` at `respondBy + 20`. |
| `expirePickupHolds` | every 30 min | C | pickup store orders `ready` past `holdUntil` → `cancelled` (system), stock released, customer told they were not charged. |
| `publishDueJobOffers` | every 5 min | D | `scheduled` offers with `opensAt ≤ now` → `open`; open offers older than 15 min without `nudgedAt` → staff `job_unclaimed`. |
| `markStaleDriversOffline` | every 5 min | D | unchanged. |
| `expireQuotes` | every 15 min | E | `quoted` with `offerValidUntil ≤ now` → `expired`. |
| `runDailyPayouts` | 21:00 | E | §3.9. |
| `captureDuePayments` | every 30 min | B | §3.8 deadline captures, `capture_failed` retries and stuck `capture_pending` recovery. |

### 5.8 Notifications

New `NotificationType`s: `order_store_update`, `pickup_ready`, `refund_issued`, `quote_update`,
`issue_update`, `support_reply`, `store_order_new`, `store_order_reminder`, `store_order_update`,
`store_issue`, `job_offer`, `job_update`, `payout_sent`, `vehicle_review`, `store_order_late`,
`job_unclaimed`, `quote_new`, `issue_new`, `support_message`, `store_suggestion`, `capture_failed`.
Kept: `order_placed`, `order_update`, `order_delivered`, `order_cancelled`, `delivery_*`,
`chat_message`, `driver_signup`, `account_*`, `test`, `system`. Deep-link `data` keys:
`customerOrderId`, `storeOrderId`, `deliveryId`, `quoteId`, `issueId`, `threadId`, `payoutId`.

| Recipient | When | Example |
| --- | --- | --- |
| Customer | placed | "Order IS-10042 placed · 2 stores · $388.25 held on Visa ••4242" |
| Customer | store accepted (with shortage) | "Boltbin confirmed your items. 20 of 24 joist hangers in stock — you won't be charged for 4." |
| Customer | rejected / cancelled by store | "Glassmoor can't fill your order (out of stock). You won't be charged $116.36." |
| Customer | pickup ready | "Ready at Copperline Plumbing Depot · show PIN 4831 at the counter · held until Fri 5:00 pm" |
| Customer | out for delivery | "Marco is on the way from Kestrel Lumber Yard · by 1:50 pm" (tap to track) |
| Customer | arrived / delivered / failed | "Marco is at your site" · "Delivered to Leslieville semi reno — see the drop-off photo" · "We couldn't complete the Kestrel delivery — we're on it." |
| Customer | quote ready / issue update / support reply / refund | "Your quote Q-10002 is ready · $1,299.70 · valid until Sat 4:15 pm" · "CASE-10001 resolved: $39.22 refunded" |
| Store members (new orders and reminders also by SMS to `alertPhone`: suppliers have no app, and the portal alerts only while it is open) | new order, reminder, customer cancelled, driver heading, driver at counter, issue reported | "IS-10042-C is waiting. Accept or reject in InstaSupply." |
| Store owners | payout sent | "Payout $170.83 for Thu, Nov 19" |
| Drivers | new fitting offer (online only), store ready, job cancelled/withdrawn, assigned by dispatch, payout, vehicle review | "$47.75 · Kestrel, Etobicoke → Leslieville · Pickup truck · 182 kg" |
| Staff | store order late, job unclaimed, delivery failed, capture failed, new quote / issue / support message, store suggestion (silent), driver sign-up, vehicle review | "IS-10042-C not accepted after 10 min (Voltway)" |

**Channels** (`channelFor`): `jobs` (job_*), `assignments` (delivery_assigned/unassigned/cancelled),
`orders` (order_* (incl. order_store_update), pickup_ready, refund_issued, quote_update, issue_update),
`store` (store_order_*, store_issue), `chat` (chat_message, support_*), `updates` (everything
else). New Android channels: the driver app adds `jobs` (J); the customer app, which has only
`orders` and `promotions` today, adds `chat` (support replies) and `updates` (H). `store` has no device
in P0 because suppliers use the web portal (web push is P1). **Preferences:** `jobPush` gates job_*, `storeOrderPush` gates store_*, `orderPush` gates
the customer order group, `chatPush` gates chat and support, `promoPush` defaults to false (opt-in at
sign-up, CASL).

### 5.9 Error codes (`ERROR_CODES` in shared; sent as `details.code`)

| Code | HttpsError | Details | Client reaction |
| --- | --- | --- | --- |
| `PRICE_CHANGED` | failed-precondition | `pricing` | show the new total, ask to confirm |
| `WINDOW_UNAVAILABLE` | failed-precondition | `windows` | reopen the window picker |
| `OUT_OF_STOCK` | failed-precondition | `productId, available` | clamp the cart line |
| `STORE_UNAVAILABLE`, `STORE_PAUSED` | failed-precondition | `storeId` | mark the cart section |
| `OUT_OF_RANGE`, `TOO_LARGE`, `JOBSITE_VEHICLE_LIMIT` | failed-precondition | `storeId`, … | offer pickup / material list |
| `EMPTY`, `TOO_MANY_STORES`, `NO_DROPOFF`, `DELIVERY_UNAVAILABLE`, `PICKUP_UNAVAILABLE` | failed-precondition | `storeId` when per store | fix the cart or switch fulfilment (every `PricingErrorCode` is thrown upper-cased, so the two lists stay in step) |
| `OUTSIDE_SERVICE_AREA`, `PHONE_UNVERIFIED`, `PAYMENTS_DISABLED` | failed-precondition | — | route to the fix |
| `CARD_DECLINED` | failed-precondition | `reason` | choose another card |
| `VERSION_CONFLICT` | failed-precondition | `version` | reload the store order |
| `STORE_NOT_READY`, `DRIVER_NOT_ASSIGNED` | failed-precondition | — | explain |
| `CODE_INCORRECT` | invalid-argument | `remaining` | retry |
| `CODE_LOCKED`, `RATE_LIMITED`, `TOO_MANY_JOBS` | resource-exhausted | — | call ops / wait |
| `PHOTO_REQUIRED` | invalid-argument | — | open the camera |
| `OFFER_TAKEN`, `VEHICLE_TOO_SMALL`, `DRIVER_OFFLINE`, `RELEASED_RECENTLY` | failed-precondition | — | remove the card / explain |
| `QUOTE_EXPIRED`, `QUOTE_VERSION` | failed-precondition | — | reload / request a fresh quote |
| `ISSUE_WINDOW_CLOSED`, `ISSUE_ALREADY_OPEN`, `REFUND_LIMIT` | failed-precondition | — | explain |

### 5.10 Idempotency and concurrency rules

- Client-retried writes use client UUID document ids (D17); gateway calls use deterministic keys
  (`auth_`, `void_`, `capture_`, `refund_`, `payout_`); notifications use `key = {eventId}-{suffix}`;
  ledger entries use deterministic ids with `create()`.
- `reserved` changes only inside the transactions that change the lines or status justifying it.
- Single writers: `orders.storeOrders/current/status` → `syncOrderAggregate`; `orders.payment` →
  payments module; `storeOrders.driver` → projection; everything else → callables.
- Supplier and staff store-order actions send `expectedVersion` (including `completePickup`).
- No network call inside a transaction.
- A failed checkout transaction voids its authorization only when `orders/{orderId}` doesn't exist
  afterwards (§3.8).

### 5.11 Route plans with pickup stops (D; optimizer change by A)

Today every active delivery is one stop and `optimizeStops` has no ordering constraints, so 2-opt
could put a drop-off before its pickup. Changes:

- `planRoute` gives an `accepted` (or `assigned`) marketplace delivery that isn't collected **two**
  stops: pickup (id `{deliveryId}:pickup`, store location, `windowStart = pickup.readyBy`, service
  time = the class's `loadMinutes`) and drop-off (id `{deliveryId}`, jobsite, delivery window).
  Collected deliveries and manual deliveries keep one drop-off stop.
- `OptimizerStop` gains `after?: string` (the id of a stop that must come earlier). The initial
  nearest-neighbour tour only picks a stop once its `after` stop is placed, and 2-opt and relocate
  moves that break an `after` order are rejected. `lockedFirstId` still pins the stop being driven to.
- `RouteStop.kind` marks each stop. Tracking computes `stopsBefore` and the scheduled ETA against the
  **drop-off** stop (`kind === 'dropoff'`), never the first stop with the same `deliveryId`.

---

## 6. Security rules and indexes (F)

### 6.1 Claims and helpers

Only functions set claims: customer `{role}`; supplier `{role:'supplier', active, storeId,
storeRole}`; driver `{role:'driver', active, cityId, capacityClass}`; staff `{role:'admin' |
'dispatcher', active}`. Apps refresh the ID token when the profile's role, store, city or class
differs from the claims.

```
function isAdmin()               { return role() == 'admin' && isActive(); }
function isSupplier()            { return role() == 'supplier' && isActive() && request.auth.token.get('storeId', '') != ''; }
function myStore()               { return request.auth.token.get('storeId', ''); }
function isStoreMember(storeId)  { return isSupplier() && myStore() == storeId; }
function isStoreOwner(storeId)   { return isStoreMember(storeId) && request.auth.token.get('storeRole', '') == 'owner'; }
function driverAudienceKey()     { return request.auth.token.get('cityId', '') + ':' + request.auth.token.get('capacityClass', ''); }
function isNanp(v)               { return v is string && v.matches('^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'); }
function isOnPostal(v)           { return v is string && v.matches('^[KLMNP][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$'); }
function inServiceArea(p)        { return p.lat is number && p.lng is number && p.lat >= 43.25 && p.lat <= 44.15
                                          && p.lng >= -80.0 && p.lng <= -78.75; }
function vehicleClasses()        { return ['car', 'suv', 'pickup', 'cargo_van', 'box_truck', 'flatbed']; }
function cityIds()               { return ['toronto','mississauga','brampton','vaughan','markham','richmond_hill','oakville',
                                           'burlington','milton','pickering','ajax','whitby','oshawa','newmarket','aurora']; }
```

### 6.2 Role matrix (anything not listed is denied; R = read, W = write)

| Collection | Public | Customer | Supplier (store S) | Driver | Staff |
| --- | --- | --- | --- | --- | --- |
| `users/{uid}` | – | R/W own (5 fields) | R/W own (`displayName, photoURL, preferences`); owner lists `storeId == S, role == 'supplier'` | R/W own (`displayName, photoURL, preferences`) | R |
| `users/{uid}/jobsites`, `cards`, `favorites` | – | R/W own (validated) | – | – | – |
| `users/{uid}/devices` | – | own | own | own | own |
| `carts/{uid}` (P1) | – | R/W own (validated) | – | – | – |
| `categories` | R | R | R | R | R; W |
| `stores` | R | R | R | R | R |
| `stores/{id}/private` | – | – | R if owner of S | – | R |
| `stores/{id}/reviews` | R | R; create/update own after completion; delete own | R | R | R; delete |
| `products` | R | R | R; create/update own store (locked fields); delete if owner and `reserved == 0` | R | R; W (admin delete) |
| `orders` | – | R own | – | – | R |
| `storeOrders` | – | get own | get/list `storeId == S` | – | R |
| `storeOrders/{id}/private` | – | – | – | – | R |
| `deliveries` (+ events, private) | – | – | – | R assigned + its events, never `private` (hand-off code), as today | R; limited update |
| `jobOffers` | – | – | – | R when `status == 'open'` and `driverAudienceKey() in audience` | R |
| `tracking` | get | get | get | get | get |
| `routes`, `driverLocations`, `threads` | as today | | | | |
| `supportThreads` (+ messages) | – | R own (`{uid}`); create message as `customer`; reset own unread | R `store_S`; create message as `supplier`; reset own unread | – | R; create as `staff`; update status/assignee/unread |
| `quotes` | – | R own | – | – | R; limited update |
| `quotes/{id}/private` | – | – | – | – | R/W |
| `issues` | – | R own | R `storeId == S` | – | R; limited update |
| `issues/{id}/private` | – | – | – | – | R/W |
| `ledgerEntries`, `payouts` | – | – | R if owner and `payeeType == 'store' && payeeId == S` | R own (`payeeType == 'driver'`) | R |
| `storeSuggestions` | – | – | – | – | R; update `status` |
| `notifications`, `devOutbox` | as today | | | | |

### 6.3 Rules (new and changed blocks of `firebase/firestore.rules`)

```
match /users/{uid} {
  allow get: if isSelf(uid) || isStaff();
  allow list: if isStaff() || (isStoreOwner(resource.data.storeId) && resource.data.role == 'supplier');
  allow create, delete: if false;
  allow update: if isSelf(uid)
    && onlyChanges(['displayName', 'photoURL', 'preferences', 'companyName', 'accountType', 'updatedAt'])
    && isText(request.resource.data.displayName, 1, 80)
    && (!('preferences' in request.resource.data) || request.resource.data.preferences is map)
    && (!changedKeys().hasAny(['companyName', 'accountType']) || isCustomer())
    && (request.resource.data.get('companyName', null) == null || isText(request.resource.data.companyName, 1, 80))
    && (request.resource.data.get('accountType', null) == null
        || request.resource.data.accountType in ['contractor', 'renovator', 'builder', 'homeowner']);
  match /jobsites/{jobsiteId} {
    allow read, delete: if isSelf(uid);
    allow create, update: if isSelf(uid) && isCustomer() && isValidJobsite(request.resource.data);
  }
  match /cards/{cardId} { allow read, delete: if isSelf(uid); allow create, update: if isSelf(uid) && isValidCard(request.resource.data); }
  // isValidCard: brand in ['visa','mastercard','amex','discover','card'] (rupay removed); otherwise unchanged.
  // favorites, devices: unchanged.
}
function isValidJobsite(d) {
  return d.keys().hasOnly(['label', 'line1', 'line2', 'city', 'province', 'postalCode', 'location', 'cityId', 'areaLabel',
      'contactName', 'contactPhone', 'instructions', 'receiving', 'maxVehicleClass', 'isDefault', 'lastUsedAt',
      'createdAt', 'updatedAt'])
    && isText(d.label, 1, 40) && isText(d.line1, 3, 160) && (d.get('line2', null) == null || isText(d.line2, 1, 60))
    && isText(d.city, 1, 60) && d.province == 'ON'
    && (d.get('postalCode', null) == null || isOnPostal(d.postalCode))   // null: new build, pin only
    && inServiceArea(d.location) && d.cityId in cityIds() && isText(d.areaLabel, 1, 80)
    && isText(d.contactName, 1, 80) && isNanp(d.contactPhone)
    && (d.get('instructions', null) == null || isText(d.instructions, 1, 500))
    && d.receiving in ['attended', 'unattended']
    && (d.get('maxVehicleClass', null) == null || d.maxVehicleClass in vehicleClasses())
    && d.isDefault is bool && d.updatedAt == request.time
    && (resource == null ? d.createdAt == request.time : d.createdAt == resource.data.createdAt)
    && d.get('lastUsedAt', null) == (resource == null ? null : resource.data.get('lastUsedAt', null));  // placeOrder writes it
}

match /carts/{uid} {   // P1 client; rules ship in P0
  allow read, delete: if isSelf(uid);
  allow create, update: if isSelf(uid) && isCustomer()
    && request.resource.data.keys().hasOnly(['lines', 'promoCode', 'unloadHelpStoreIds', 'fulfilment', 'jobsiteId', 'updatedAt'])
    && request.resource.data.lines is list && request.resource.data.lines.size() <= 100
    && request.resource.data.get('unloadHelpStoreIds', []) is list && request.resource.data.get('unloadHelpStoreIds', []).size() <= 5
    && (request.resource.data.promoCode == null || isText(request.resource.data.promoCode, 2, 20))
    && request.resource.data.fulfilment in ['delivery', 'pickup'] && request.resource.data.updatedAt == request.time;
}

match /stores/{storeId} {
  allow read: if true;
  allow write: if false;                                  // createStore, updateStoreSettings, updateStoreProfile
  match /private/{docId} { allow read: if isStaff() || isStoreOwner(storeId); allow write: if false; }
  match /reviews/{storeOrderId} {
    allow read: if true;
    allow create, update: if isCustomer() && isValidStoreReview(storeId, storeOrderId);
    allow delete: if isStaff() || (signedIn() && resource.data.customerId == request.auth.uid);
  }
}
function isValidStoreReview(storeId, storeOrderId) {
  let d = request.resource.data;
  let so = get(/databases/$(database)/documents/storeOrders/$(storeOrderId)).data;
  return d.keys().hasOnly(['storeId', 'storeOrderId', 'customerId', 'authorName', 'rating', 'text', 'createdAt', 'updatedAt'])
    && so.customerId == request.auth.uid && so.storeId == storeId && so.status in ['delivered', 'picked_up']
    && d.storeId == storeId && d.storeOrderId == storeOrderId && d.customerId == request.auth.uid
    && d.rating is int && d.rating >= 1 && d.rating <= 5 && isText(d.text, 0, 1000) && isText(d.authorName, 1, 40)
    && d.updatedAt == request.time
    && (resource == null ? d.createdAt == request.time : d.createdAt == resource.data.createdAt);
}

match /products/{productId} {
  allow read: if true;
  allow create: if (isStaff() || isStoreMember(request.resource.data.storeId))
    && productId.split('--')[0] == request.resource.data.storeId
    && isValidProduct(request.resource.data) && request.resource.data.reserved == 0
    && request.resource.data.createdAt == request.time
    && !request.resource.data.keys().hasAny(['searchTerms', 'listed', 'storeName', 'storeStatus', 'imageUrl'])
    && (isStaff() || (request.resource.data.featured == false && request.resource.data.get('badge', null) == null
                      && request.resource.data.get('familyKey', null) == null));
  allow update: if (isStaff() || (isStoreMember(resource.data.storeId) && !changedKeys().hasAny(['featured', 'badge', 'familyKey'])))
    && !changedKeys().hasAny(['storeId', 'sku', 'reserved', 'searchTerms', 'listed', 'storeName', 'storeStatus', 'imageUrl',
                              'createdAt'])        // sku is part of the id
    && isValidProduct(request.resource.data);
  allow delete: if (isAdmin() || isStoreOwner(resource.data.storeId)) && resource.data.reserved == 0;
}
function isValidProduct(d) {
  return d.keys().hasOnly(['storeId', 'sku', 'name', 'brand', 'categoryId', 'familyKey', 'unit', 'size', 'description',
      'priceCents', 'compareAtCents', 'stockOnHand', 'reserved', 'maxPerOrder', 'weightKg', 'dimsCm', 'shipEstimated',
      'active', 'featured', 'badge', 'imageKey', 'imagePath', 'imageUrl', 'listed', 'storeName', 'storeStatus',
      'searchTerms', 'createdAt', 'updatedAt', 'updatedBy'])
    // photos are uploads of this store; imageUrl is derived by onProductWritten, never typed by a client
    && (d.get('imagePath', null) == null || d.imagePath.matches('productPhotos/' + d.storeId + '/[^/]+'))
    && isText(d.name, 2, 120) && isText(d.sku, 1, 40) && (d.get('brand', null) == null || isText(d.brand, 1, 60))
    && d.categoryId in ['adhesives','fasteners','tools','safety','wood','drywall','insulation','masonry','roofing','electrical',
                        'plumbing','hvac','doors','windows','glass','hardware','paint','flooring','wall-decor','cleaning',
                        'storage','bath','kitchen','appliances','outdoors']
    && d.unit in ['each','pair','sheet','length','bundle','box','bag','pail','can','tube','roll','pack','kit']
    && (d.get('size', null) == null || isText(d.size, 1, 60))
    && d.priceCents is int && d.priceCents >= 1 && d.priceCents <= 10000000
    && (d.get('compareAtCents', null) == null || (d.compareAtCents is int && d.compareAtCents > d.priceCents))
    && d.stockOnHand is int && d.stockOnHand >= 0 && d.stockOnHand <= 1000000 && d.reserved is int
    && (d.get('maxPerOrder', null) == null || (d.maxPerOrder is int && d.maxPerOrder >= 1 && d.maxPerOrder <= 9999))
    && d.weightKg is number && d.weightKg > 0 && d.weightKg <= 3000
    && d.dimsCm.l is number && d.dimsCm.l > 0 && d.dimsCm.l <= 1500
    && d.dimsCm.w is number && d.dimsCm.w > 0 && d.dimsCm.h is number && d.dimsCm.h > 0
    && d.shipEstimated is bool && d.active is bool && d.featured is bool
    && (d.get('badge', null) == null || d.badge in ['new', 'bestseller', 'deal'])
    && isText(d.description, 0, 2000) && d.updatedAt == request.time && d.updatedBy == request.auth.uid;
}

match /orders/{orderId} { allow read: if isStaff() || (signedIn() && resource.data.customerId == request.auth.uid); allow write: if false; }
match /storeOrders/{storeOrderId} {
  allow get: if isStaff() || isStoreMember(resource.data.storeId) || (signedIn() && resource.data.customerId == request.auth.uid);
  allow list: if isStaff() || isStoreMember(resource.data.storeId);        // query must filter storeId == myStore
  allow write: if false;
  match /private/{docId} { allow read: if isStaff(); allow write: if false; }
}
match /jobOffers/{deliveryId} {
  allow read: if isStaff() || (isActiveDriver() && resource.data.status == 'open' && driverAudienceKey() in resource.data.audience);
  allow write: if false;
}
// deliveries: unchanged, except the staff-editable keys become
//   ['customer','address','location','addressNotes','notes','packageCount','priority','requireCode','windowStart','windowEnd',
//    'unload','updatedAt','updatedBy']   (codAmount removed; unload added for labourer booking)

match /quotes/{quoteId} {
  allow read: if isStaff() || (signedIn() && resource.data.customerId == request.auth.uid);
  allow update: if isStaff() && onlyChanges(['assignedTo', 'assignedName', 'status', 'updatedAt'])
    && (request.resource.data.status == resource.data.status
        || (resource.data.status == 'submitted' && request.resource.data.status == 'in_review'));
  allow create, delete: if false;
  match /private/{docId} { allow read, write: if isStaff(); }
}
match /issues/{issueId} {
  allow read: if isStaff() || (signedIn() && resource.data.customerId == request.auth.uid) || isStoreMember(resource.data.storeId);
  allow update: if isStaff() && onlyChanges(['assignedTo', 'assignedName', 'status', 'updatedAt'])
    && (request.resource.data.status == resource.data.status
        || (resource.data.status == 'open' && request.resource.data.status == 'in_review'));
  allow create, delete: if false;
  match /private/{docId} { allow read, write: if isStaff(); }
}

function isSupportOwner(threadId) {
  return (isCustomer() && threadId == request.auth.uid) || (isSupplier() && threadId == 'store_' + myStore());
}
match /supportThreads/{threadId} {
  allow read: if isStaff() || isSupportOwner(threadId);
  allow create, delete: if false;
  allow update: if (isSupportOwner(threadId) && onlyChanges(['unreadByOwner', 'ownerReadAt']) && request.resource.data.unreadByOwner == 0)
    || (isStaff() && onlyChanges(['unreadByStaff', 'staffReadAt', 'status', 'assignedTo', 'assignedName'])
        && request.resource.data.status in ['open', 'resolved']);
  match /messages/{messageId} {
    allow read: if isStaff() || isSupportOwner(threadId);
    allow create: if request.resource.data.keys().hasOnly(['text', 'senderId', 'senderName', 'senderRole', 'context', 'createdAt'])
      && request.resource.data.senderId == request.auth.uid && request.resource.data.createdAt == request.time
      && isText(request.resource.data.text, 1, 1000) && isText(request.resource.data.senderName, 1, 80)
      && (request.resource.data.get('context', null) == null
          || (request.resource.data.context.kind in ['order', 'store_order', 'quote', 'issue']
              && isText(request.resource.data.context.id, 1, 80) && isText(request.resource.data.context.label, 1, 80)))
      && ((isStaff() && request.resource.data.senderRole == 'staff')
          || (isCustomer() && threadId == request.auth.uid && request.resource.data.senderRole == 'customer')
          || (isSupplier() && threadId == 'store_' + myStore() && request.resource.data.senderRole == 'supplier'));
    allow update, delete: if false;
  }
}

match /ledgerEntries/{entryId} {
  allow read: if isStaff() || (resource.data.payeeType == 'store' && isStoreOwner(resource.data.payeeId))
                           || (resource.data.payeeType == 'driver' && isSelf(resource.data.payeeId));
  allow write: if false;
}
match /payouts/{payoutId} { /* same read rule as ledgerEntries */ allow write: if false; }
match /storeSuggestions/{id} {
  allow read: if isStaff();
  allow update: if isStaff() && onlyChanges(['status', 'updatedAt'])
    && request.resource.data.status in ['new', 'contacted', 'onboarding', 'dismissed'];
  allow create, delete: if false;
}
// Removed: /users/{uid}/addresses, /products/{id}/reviews, the driver self-edit of `vehicle`.
```

### 6.4 Storage rules (`firebase/storage.rules`)

```
function isStoreMemberClaim(storeId) { return role() == 'supplier' && request.auth.token.get('active', false) == true
                                              && request.auth.token.get('storeId', '') == storeId; }
match /proofs/{deliveryId}/{fileName} {          // drop-off photos; the customer can now see theirs
  allow read: if isStaff() || isAssignedDriver(deliveryId)
    || (request.auth != null && firestore.get(/databases/(default)/documents/deliveries/$(deliveryId)).data.customerId == request.auth.uid);
  allow create: if isAssignedDriver(deliveryId) && isImageUnder(10);
  allow update, delete: if false;
}
match /quoteUploads/{uid}/{requestId}/{fileName} {
  allow read: if isStaff() || (request.auth != null && request.auth.uid == uid);
  allow create: if request.auth != null && request.auth.uid == uid && role() == 'customer' && request.resource.size < 15 * 1024 * 1024
    && request.resource.contentType.matches('image/.*|application/pdf|text/csv|application/vnd[.]ms-excel|application/vnd[.]openxmlformats-officedocument[.]spreadsheetml[.]sheet');
  allow update, delete: if false;
}
match /issuePhotos/{issueId}/{fileName} {
  allow read: if isStaff() || (request.auth != null && resource.metadata.ownerUid == request.auth.uid)
    || isStoreMemberClaim(firestore.get(/databases/(default)/documents/issues/$(issueId)).data.storeId);
  allow create: if request.auth != null && role() == 'customer' && request.resource.metadata.ownerUid == request.auth.uid && isImageUnder(10)
    && (!firestore.exists(/databases/(default)/documents/issues/$(issueId))
        || firestore.get(/databases/(default)/documents/issues/$(issueId)).data.customerId == request.auth.uid);
  allow update, delete: if false;
}
match /storePhotos/{storeId}/{fileName} {
  allow read: if true;
  allow create: if (isStaff() || (isStoreMemberClaim(storeId) && request.auth.token.get('storeRole', '') == 'owner')) && isImageUnder(5);
  allow update, delete: if false;
}
match /productPhotos/{storeId}/{fileName} {
  allow read: if true;
  allow create: if (isStaff() || isStoreMemberClaim(storeId)) && isImageUnder(5);
  allow update, delete: if false;
}
// avatars/{uid}: unchanged.
```

### 6.5 Composite indexes (`firebase/firestore.indexes.json`)

| # | Collection | Fields | Used by |
| --- | --- | --- | --- |
| 1 | products | listed ↑, searchTerms CONTAINS | cross-store search (G, I2 quote builder) |
| 2 | products | listed ↑, categoryId ↑, name ↑ | category across stores |
| 3 | products | listed ↑, featured ↑, name ↑ | "Popular near you" |
| 4 | products | storeId ↑, listed ↑, name ↑ | store page |
| 5 | products | storeId ↑, listed ↑, categoryId ↑, name ↑ | store page category chip |
| 6 | products | storeId ↑, name ↑ | portal catalogue |
| 7 | products | familyKey ↑, listed ↑, priceCents ↑ | "Also at" |
| 8 | storeOrders | storeId ↑, status ↑, timing.readyBy ↑ | portal board (`status in […]`) |
| 9 | storeOrders | storeId ↑, createdAt ↓ | portal history |
| 10 | storeOrders | storeId ↑, completedAt ↓ | portal insights |
| 11 | storeOrders | status ↑, timing.respondBy ↑ | escalation |
| 12 | storeOrders | fulfilment ↑, status ↑, pickup.holdUntil ↑ | pickup expiry |
| 13 | storeOrders | status ↑, createdAt ↓ | ops store-order queue |
| 14 | orders | customerId ↑, createdAt ↓ (exists) | order history |
| 15 | orders | customerId ↑, status ↑, createdAt ↓ | active orders on Home |
| 16 | orders | status ↑, createdAt ↓ (exists) | ops orders |
| 17 | orders | payment.status ↑, payment.captureDeadlineAt ↑ | capture sweep |
| 18 | orders | needsAttention ↑, createdAt ↓ | ops dashboard |
| 19 | jobOffers | status ↑, audience CONTAINS, openedAt ↓ | driver job board |
| 20 | jobOffers | status ↑, opensAt ↑ | publisher, ops `/jobs` |
| 21 | jobOffers | status ↑, openedAt ↑ | unclaimed nudge |
| 22 | quotes | customerId ↑, createdAt ↓ | customer list |
| 23 | quotes | status ↑, respondBy ↑ | ops inbox (SLA) |
| 24 | quotes | status ↑, createdAt ↓ | ops tabs |
| 25 | quotes | status ↑, offerValidUntil ↑ | expiry |
| 26 | issues | customerId ↑, createdAt ↓ | customer list |
| 27 | issues | storeId ↑, createdAt ↓ | portal |
| 28 | issues | status ↑, createdAt ↓ | ops queue |
| 29 | supportThreads | kind ↑, updatedAt ↓ | ops inbox tabs |
| 30 | supportThreads | status ↑, updatedAt ↓ | ops inbox filter |
| 31 | ledgerEntries | payeeType ↑, payeeId ↑, createdAt ↓ | portal payouts, driver earnings |
| 32 | ledgerEntries | payoutId ↑, createdAt ↑ | payout run (`payoutId == null`) |
| 33 | payouts | payeeType ↑, payeeId ↑, createdAt ↓ | portal, driver app, ops |
| 34 | storeSuggestions | status ↑, createdAt ↓ | ops |
| 35 | users | role ↑, status ↑ (exists) | staff cache |
| 36 | users | role ↑, status ↑, cityId ↑ | job-offer fan-out |
| 37 | users | storeId ↑, role ↑, status ↑ | store members, team page |
| — | deliveries | the existing six | unchanged |
| — | notifications | the existing two | unchanged |
| — | driverLocations | online ↑, updatedAt ↑ (exists) | `markStaleDriversOffline` |

**Removed:** products `categoryId/active/name`, `active/featured/name`, `active/searchTerms`.
**Field overrides (not indexed):** `orders.storeOrders`, `orders.placed`, `orders.payment.events`,
`storeOrders.lines`, `storeOrders.history`, `storeOrders.load`, `deliveries.load`, `jobOffers.load`,
`quotes.request`, `quotes.offer`, `products.description`, plus the existing `routes.*`, `events.at` and
`devices.token` (collection group) overrides. **TTL:** `rateLimits.expiresAt` (plus existing
`otpChallenges`, `devOutbox`). An index test (F) compares this table with every query in the apps and
functions.

---

## 7. Customer app (`apps/customer`, Expo; keep the Big Cart UI language)

### 7.1 Look and copy

Keep the Big Cart tokens: lime gradient buttons (`#AEDC81 → #6CC51D`), Poppins, white cards on
`#F4F5F9`, pastel circles behind artwork, the floating gradient cart button. Green
(`primaryDark #28B446`) marks delivery promises and status pills, as on the site. `productBackdrops`
(grocery map) is replaced by each category's `tint`. Artwork is construction (§12.7). Copy is
Canadian English and trade wording ("studs", "sheets", "lengths", "labourer", "colour", "jobsite").

### 7.2 Session, navigation, providers

- `SessionStatus = 'loading' | 'onboarding' | 'guest' | 'needs_profile' | 'needs_phone' | 'wrong_account' | 'ready'`
  (`signed_out` becomes `guest` once the intro is seen). Root guards: `(intro)` for onboarding;
  `(shop)` for `guest` and `ready`; `(auth)` for `guest` (pushed with `?next=`); `(setup)` for the setup
  statuses. Screens marked 🔒 render `<RequireAccount>` ("Sign in to order" / "Create account").
- Tabs: **Home · Stores · Orders · Account** + floating cart button (`ShopTabBar`).
- `SiteProvider` (`features/site`): the current site = a saved jobsite, or for guests a GPS/pin
  location (AsyncStorage `instasupply.site.v1`). Every distance, promise and price preview uses it.
  It also exports the jobsite data hooks (`useJobsites`, `saveJobsite`, `deleteJobsite`,
  `setDefaultJobsite`) used by the H screens.
- `CartProvider` v2 (AsyncStorage `instasupply.cart.v2`, v1 is discarded): lines `{productId, storeId,
  quantity}` (1–9 999, ≤ 100 lines, ≤ 5 stores — a 6th store shows "One order can include up to 5
  stores"), `promoCode`, `unloadHelpStoreIds`. `useCartPricing(uid)` joins live products, stores,
  site and profile and returns `{ groups, pricing: PricedCheckout, warnings }` from `priceCheckout`.
- Callables via `lib/callables.ts` (H). Ids for `checkoutId`, `requestId`, `issueId` come from
  `newRequestId()` (expo-crypto `randomUUID`) and are kept in screen state across retries.

### 7.3 Screens

| Route (`src/app`) | Content | Data / actions |
| --- | --- | --- |
| `(intro)/intro` | 3 slides: "Order building supplies on your jobsite" · "One search across local suppliers, live stock" · "Delivered to your site or ready for pickup — track every step" | — |
| `(auth)/welcome, login, signup, forgot-password` | Welcome adds "Browse first". Sign-up: name, company (optional), "I'm a…" chips (Contractor, Renovator, Builder, Homeowner), email, password, "Send me deals" opt-in | `registerCustomer` |
| `(setup)/complete-profile, verify-phone, verify-code, wrong-account` | +1 phone chip, mask `(416) 555-0110` | OTP callables |
| `(shop)/(tabs)/index` Home | Header: avatar + **jobsite switcher** "Deliver to · Leslieville semi reno ▾" (→ `site`). Search bar "Search 2x4, drywall, PEX…". **Active order cards** (≤ 3): headline, mini map for an out-for-delivery store order, "Arriving in 25 mins", "+13 items · 4 Stores · $523.40 · Card held / Paid". Category grid (8 + "See all", 3D icons on pastel circles). **Stores near you** carousel (the mock's wording). Perk banners: "$0 delivery fee on your first order", "First order $250+? $20 off", "Free delivery on orders over $500", "Send us your material list". **Buy again** rail (top 12 products of the last 10 orders). Popular near you (featured). Footer cards: "Send us your material list", "Don't see your supplier? Suggest a store". | stores, featured listings, active orders (index 15), tracking docs |
| `(shop)/(tabs)/stores` | "Stores near you". List ⇄ map (react-native-maps; Leaflet `.web.tsx`). Chips: Delivery today, Pickup, Open now, specialties. Sort: Fastest, Nearest, Top rated. Card: photo/art, name, specialty label, km, promise ("Delivery by 1:50 pm" / "Pickup ready in 25 min" / "Opens tomorrow 6:30 am" / "Joining InstaSupply"), ★4.9 (50), badge (§2.8: Onboarding now, Coming soon, Paused, Closed · opens 7:00 am); art fallback = the store's `store-*` `imageKey` | `stores where marketId == 'gta'` (hide `closed`), `storeAvailability()` |
| `(shop)/site` (sheet) | Saved jobsites · use current location · address search · drop a pin · "Save as jobsite" (🔒) | `geocodeAddress`, `SiteProvider` |
| `(shop)/search` | Example chips from the site (2×4×8 SPF studs, Drywall 1/2 in, 3/4" Type L copper, Rebar 10M 20 ft, Subfloor screws, Spray foam low expansion); recent searches. Results grouped by `familyKey` ("2x4x8 SPF stud · from $4.79 · 2 stores · nearest 13.0 km · in stock"), single listings show store, km, price, stock pill, promise. Filters: category, delivery today, pickup, in stock. Sort: best match, price, distance, fastest. Empty: "Can't find it? Send us your list" | index 1 + client ranking by distance |
| `(shop)/categories`, `category/[id]` | 25 tiles; listing across nearby stores with the same filters; empty: "No nearby store carries this yet. Send us your list." | index 2 |
| `(shop)/store/[id]` | Hero, ★ rating, open/closes, address + directions, delivery promise and pickup time, fulfilment pills, "Free delivery on orders over $500", category chips, in-store search, products. Non-live stores are browse-only. | indexes 4, 5 |
| `(shop)/store/[id]/reviews`, `store/[id]/review` 🔒 | Review list; rate a completed store order (`?storeOrderId=`), reuses `StarPicker` | rules-validated write |
| `(shop)/product/[id]` | Art on a pastel circle, brand, name, size, **$4.79 / each**, compare-at struck through, SKU, stock ("1,200 in stock at Kestrel" / "Only 4 left" / "Out of stock"), stepper with bulk chips (+10, +25, +50; tap to type), weight, size, flags ("Long load", "Sheet goods"), store row, **Also at** (family offers: price, km, stock), sticky "Add to cart · $95.80", save 🔒 | product + index 7 |
| `(shop)/cart` | **Grouped by store**: header (store, km, promise), lines, subtotal, load chip ("Pickup truck · 182 kg · 8 ft"), fee preview ("Delivery $53.83" or ~~$53.83~~ Free), warnings (paused, closed, not live, only N left, out of range → "Pickup only from this store", too large → "Send as a material list" one-tap conversion). Order-level free-delivery meter "Add $171.42 more for free delivery", first-order banners, promo field with its status message, totals (items, delivery, labourer, discount, HST 13 %, total). Checkout (guests → sign in) | `useCartPricing` |
| `(shop)/saved` 🔒 | Saved materials | favorites |
| `(shop)/checkout/index` 🔒 | **Delivery \| Pickup**. Jobsite card (pin, address, site contact; change → `checkout/jobsite`). Receiving: "Someone on site (they get a 4-digit code)" / "Leave at site (photo on drop)". **Delivery options** (the mock's label): ASAP with per-store promises, or Schedule (→ `checkout/window`). "Add delivery instructions" (prefilled from the jobsite). **"Need help unloading? Add a labourer"** per eligible store with its price; locked on with the reason when required. Pickup mode: per-store ready time, hold-until and address. Card (→ `checkout/card`, test-mode note). Promo. Summary per store (items, ~~list fee~~/fee, labourer, discount, HST, total) and order total. **Place order · $388.25** (`checkoutId`, `expectedTotalCents`). Every §5.9 code maps to an inline fix without losing the cart. | `priceCheckout`, `placeOrder` |
| `(shop)/checkout/window`, `checkout/jobsite`, `checkout/card` 🔒 | Day chips (today … +6) and 2-h slots, unavailable ones with the reason; choose/add jobsite; choose/add card | shared window helpers |
| `(shop)/order-success` 🔒 | "Order IS-10042 placed", one row per store with its promise, "Card held · $388.25", Track order | — |
| `(shop)/(tabs)/orders` 🔒 | Segments **Active · Past · Quotes**; jobsite filter chip; cards: number, date, headline, stores, total; **Reorder** | indexes 14, 15, 22 |
| `(shop)/orders/[id]` 🔒 | Headline, jobsite and window. One card per store order: status timeline, driver row, promise, shorted lines ("20 of 24 — out of stock"), **pickup PIN card** (pickup, once ready), hand-off code (attended delivery), **drop-off photo** (delivered), actions: Track, Cancel these items (new/accepted), Report a problem (≤ 48 h), Rate store, Contact support (context chip). Receipt: placed vs current, HST with the registration number (`hstNumber`; contractors need it to claim input tax credits), released/refunded, card. **Reorder** and **Reorder & checkout** (same jobsite, ASAP, default card). Cancel order | order, store orders (`get`), tracking |
| `(shop)/orders/[id]/track/[storeOrderId]` 🔒 | Full-screen live map (store pin, site pin, driver). Phase: "Heading to Kestrel Lumber Yard" → "Loaded at the store" → "On the way to your site"; live ETA while in transit; deliver-by; driver first name and vehicle; hand-off code; share tracking link | `tracking/{token}` |
| `(shop)/issues/new` 🔒 (`?storeOrderId=`) | Items and quantities, type, photos (camera/library → `issuePhotos/{issueId}/…` uploaded with `customMetadata.ownerUid = uid`, which the Storage rules require; ≥ 1 for damaged/wrong item), description, preferred resolution (Replacement / Refund / Return). "Keep the item and its packaging until we sort it out." | Storage + `reportIssue` |
| `(shop)/issues/[id]` 🔒 | Status, resolution, refund amount, open support chat | issue |
| `(shop)/quotes/new` 🔒 | **Send us your material list** ("Type it, paste it, or upload a photo"): lines (text + quantity, "+ Add item"; pasting several lines splits them into items, a leading or trailing number becomes the quantity), attach photo / PDF / spreadsheet (expo-document-picker, expo-image-picker; ≤ 5 files, 15 MB), Needed by (ASAP, This week, Pick a date), Delivery / Pickup, jobsite, preferred contact (Call, WhatsApp, Email), notes. **Send my list** → "Material list received. Expect a quote within 30 minutes during business hours." | Storage + `submitMaterialList` |
| `(shop)/quotes/index`, `quotes/[id]`, `quotes/[id]/accept` 🔒 | Status timeline; when quoted: lines by store (special-order lines tagged), unmatched lines with reasons, totals, valid-until countdown. **Accept & pay** (card, window — the quoted one if still valid —, receiving, labourer) · Ask a question (support chat with quote context) · Decline · Request changes / Get a fresh quote | `acceptQuote`, `closeQuote`, `reopenQuote` |
| `(shop)/support` 🔒 | Chat with InstaSupply; context chips ("About IS-10042"); quick topics (Where's my order? · Change delivery time · Problem with an item · Billing); hours banner | `supportThreads/{uid}` |
| `(shop)/jobsites/index`, `jobsites/edit` 🔒 | List (default, last used). Editor: label; address search (fills line 1, city, postal code, `cityId`, area); **drop a pin** (draggable map; pin-only allowed for new builds, postal code optional: line 1 is typed, e.g. "Lot 14, Phase 3", `cityId = nearestCity(pin)` and the area is that city's name); unit/lot; site contact name and phone; instructions; receiving default; max vehicle ("Narrow lane: cargo van max"); default toggle | `features/site` hooks |
| `(shop)/cards/index`, `cards/add` 🔒 | Visa, Mastercard, Amex, Discover ("credit or debit": Visa Debit and Debit Mastercard work as Visa/Mastercard; Interac debit can't pay in-app); test-mode banner; Luhn and expiry checks | cards |
| `(shop)/(tabs)/account` | Profile (name, company, account type, phone), Jobsites, Payment cards, Saved items, Material lists & quotes, Notifications, Support chat, Suggest a store, Settings, Help & FAQ, About, Sign out. Guests: sign-in card + Suggest a store, Help, About | — |
| `(shop)/notifications` 🔒, `settings` 🔒, `help`, `about`, `suggest-store` | Inbox with deep links (§5.8 keys). Settings: order updates, deals (opt-in), chat. Help: FAQ paraphrased from the site. Suggest a store: store name, city, "What do you buy most?" chips (`SUGGEST_STORE_INTERESTS`), email (optional) → "Thanks, got it! We'll reach out to them and let you know when they're live." | `suggestStore` |

**Removed routes:** `(tabs)/favorites` (→ `saved`), `product/[id]/reviews`, `product/[id]/write-review`,
`checkout/address`, `checkout/payment` (merged into `checkout/index`), `orders/index` (→ tab),
`addresses/*` (→ `jobsites/*`).

---

## 8. Supplier portal (`apps/backoffice/src/portal`, role `supplier`)

- **Sign-in:** the shared login page. `AuthProvider` accepts `admin`, `dispatcher` and `supplier`
  (active, with `storeId`) and exposes `role`, `storeId`, `storeRole`, `store`. Customers and drivers
  are still rejected ("This is a customer account. Order in the InstaSupply app."). Suppliers land on
  `/portal`; staff guards redirect suppliers there, and `RequireSupplier` redirects staff to `/`.
- **Mount:** the ops router (I2) has one line, `{ path: '/portal/*', lazy: () => import('@/portal/PortalApp') }`,
  as a child of `StaffRoot` (inside `AuthProvider`) next to, not inside, `ProtectedLayout`, so the ops
  `RequireStaff` and `AppLayout` never wrap the portal; everything under it (`<Routes>`, layout,
  sidebar) belongs to I1. Notification deep links with `storeOrderId` open `/portal/orders/:id` for
  suppliers (I2 adds that mapping in `features/notifications`).
- **Sidebar:** Orders · Catalog · Store · Support; owners also Payouts · Insights · Team. Header: store
  name, "Pause new orders" toggle, notification bell.

| Route | Content | Data / actions |
| --- | --- | --- |
| `/portal` **Orders board** | Lanes: **New** (countdown "Accept within 7:42", red under 5 min) · **Accepted** · **Preparing** · **Ready** · **Out for delivery** (+ failed) · **Done today** (second query, index 10: `completedAt` ≥ start of today); plus **Upcoming** (later `readyByDate`). Card, in the site's style: "NMD90 14/2 cable, 75 m + 1 item · Whitfield Renovations · Leslieville · Delivery by 1:50 pm" (customer initial + surname or company, jobsite area, fulfilment badge, `readyBy` countdown, load chip, driver chip "Marco · F-150 · CBKX 214 · heading to you / at the counter"). **Alerts:** chime every 30 s while anything is New, toast, browser notification, "(2) New" tab title (`useNotificationAlerts`). Browsers block sound until the first click, so the board shows "Turn on order sound" until then; closed tabs rely on the SMS to `alertPhone` (§5.6). | `storeOrders where storeId == S and status in [...] orderBy timing.readyBy` (index 8) |
| `/portal/orders/:storeOrderId` | Pick list (SKU, item, size, qty, line total) with a **short-ship editor** (fulfilled qty + reason); actions by status: Accept · Reject (reason) · Start preparing · Mark ready · Not ready after all · **Confirm collection** (PIN pad for the driver's or customer's 4-digit PIN; shows attempts left) · Cancel (accepted, preparing or ready, reason). Customer contact and jobsite (area, site contact, instructions, receiving) or pickup customer; driver card; history; printable **pick slip** (moved from the ops orders feature). All actions send `expectedVersion`. | `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder`, `completePickup` |
| `/portal/catalog` | Table: SKU, name, brand, category, unit/size, price, on hand, reserved, available, active. Filters: category, low stock (< 10 available), inactive, "estimated size". Inline price and on-hand edits (± nudges and "set count", safe because `reserved` is separate; a count below `reserved` asks to confirm, since those units are promised), active toggle. Add/edit modal: every product field (SKU fixed after creation: it is part of the id), weight and size prefilled from category defaults with an "Estimated" checkbox, photo upload to `productPhotos/{storeId}/` that sets `imagePath`. CSV import/export (**P1**). | products (index 6); rules-validated writes |
| `/portal/store` | Photo (upload to `storePhotos/{storeId}/`), description, phone, email, **order-alert mobile** (`alertPhone`), **hours editor** (7 days + closed), closure dates, prep minutes, same-day cut-off, pickup/delivery toggles, loading notes (private: drivers see them on the job). Name, address, radius and status are read-only (ops). | `updateStoreProfile` |
| `/portal/payouts` (owner) | Unpaid balance, held entries (with the issue), daily payouts (date, orders, sales, commission, clawbacks, net, reference) with drill-down to entries | ledger entries, payouts (indexes 31, 33) |
| `/portal/insights` (owner) | Last 7 / 30 days, computed client-side over ≤ 1 000 completed store orders: sales, orders, average order, fill rate (Σ fulfilled ÷ Σ ordered), median time to accept, top products, top customers (company or name), categories. Charts **P1** (tables in P0). | index 10 |
| `/portal/team` (owner) | Members (name, role, status), invite staff, suspend | users (index 37), `inviteSupplierUser`, `setSupplierUserStatus` |
| `/portal/support` | Chat with InstaSupply (`supportThreads/store_{storeId}`), reusing `Conversation` | messages |

Shared components owned by I1 and used by ops: `features/catalog` (`CatalogWorkspace` with an
optional `storeId`; staff see `featured`, `badge`, `familyKey`) and `features/store-profile`
(profile and hours editors).

---

## 9. Ops back office (admin and dispatcher)

**Sidebar:** Operations — Dashboard, Live map, Jobs, Deliveries, Drivers, Messages · Marketplace —
Orders, Stores, Catalog, Quotes, Issues, Support, Suggestions · Finance — Payouts · Workspace — Team,
Dev SMS outbox. `BaseMap.DEFAULT_CENTER` → Toronto (43.6532, −79.3832).

| Route | Content |
| --- | --- |
| `/` Dashboard | KPIs: orders and GMV today, open store orders by status, store orders overdue for acceptance, open/scheduled job offers and unclaimed > 15 min, active deliveries, live stores, quotes waiting (SLA), open issues, unread support. **Needs attention:** overdue acceptances, failed deliveries, unclaimed offers, issues past SLA, quotes near `respondBy`, capture failures. `StoreSummary` (single grocery store) is deleted. |
| `/orders`, `/orders/:orderId` | Tabs: Orders (parent orders; filters status, store, attention) and Store orders (all, with SLA timers). Detail: customer, jobsite, window, one card per store order (status, store, driver, delivery link, actions: act for the store, cancel the store order, resolve a failed delivery, complete pickup with override), **payment events** (authorize, capture, release, refunds), issues, quote origin, support chat link. |
| `/stores`, `/stores/new`, `/stores/:storeId` | List: status, specialty, city, live products, orders in 7 days, rating, median time to accept, open now. **New store wizard:** basics → location (geocode + pin) → hours → fulfilment and radius → commission → invite owner. Detail tabs: Profile & hours (`store-profile` editors), Settings (status, radius, commission, payout account, onboarding checklist), Team (invite owner/staff), Catalog (`CatalogWorkspace storeId`), Orders, Reviews. |
| `/catalog` | All stores with a store filter; staff-only fields `featured`, `badge`, `familyKey`; categories tab (defaults, synonyms). |
| `/quotes`, `/quotes/:quoteId` | **Inbox** by status with the 30-min SLA countdown ("due in 12 min") and "Assign to me". **Builder:** the request (lines, attachment previews/links, needed-by, contact preference with `tel:` and `wa.me` links, jobsite map) beside the builder: per request line, search listings near the jobsite (price, stock, km) and add to that store's group, or add a **custom special-order line** (store, name, unit, size, qty, price, weight, size); unit-price overrides; unmatched lines with reasons; fulfilment, receiving, window, labourer; **live totals** from `priceCheckout`; validity (24/48/72 h); message; Send. Draft autosaves to `quotes/{id}/private/workspace`. |
| `/issues`, `/issues/:issueId` | Queue (SLA). Detail: photos, lines, store order, delivery proof photo, store response via the store support thread. Resolution form: kind; refund calculator (`refundForLines`, defaults to the reported lines; include delivery fee); return required; fault party; note. |
| `/support`, `/support/:threadId` | Customer and store threads (tabs), unread first; assignment and status; side panel with recent orders, open issues and quotes. |
| `/jobs` | Scheduled and open offers (age, class, payout, ready time, store → area), unclaimed > 15 min highlighted; actions: **Assign** (`AssignDialog` filtered to drivers who `canCarry`, any city; `force` with a warning), Boost (**P1**); **Labourer queue**: deliveries with `unload.status == 'needed'` → enter labourer name and phone (`unload.status = 'booked'`). |
| `/deliveries`, `/deliveries/:id` | New columns: kind, pickup store, class, payout, offer status. Detail: pickup card (ready, arrived, collected), load manifest, unload/labourer editor, payout breakdown. The create form and CSV import drop COD. |
| `/drivers`, `/drivers/:id` | City, vehicle (approved vs draft, **review**), capacity class override, compliance checkboxes (licence verified, insurance verified — required to approve), earnings, payout account (test ref until Stripe Connect). Suspending shows which jobs go back to the board. |
| `/messages` | Driver chat, unchanged. |
| `/payouts` | Payout runs and ledger entries for stores and drivers, payees skipped for a missing payout account; "Run payouts now" (admin, `runJobNow('runDailyPayouts')`, shown only where `ALLOW_TEST_JOBS=true`: emulator and staging). |
| `/suggestions` | Store suggestions with status; "Create store" pre-fills the wizard. |
| `/track/:token` (public) | Phase text ("Heading to Kestrel Lumber Yard", "On the way to your site"), store pin, deliver-by, hand-off code, Canadian copy. |

---

## 10. Driver app (`apps/driver`)

**Tabs:** Jobs · Today · Route · Earnings · Dispatch. Profile opens from the header avatar
(`(app)/profile`). Background-location profiles are unchanged; the live profile is used from
`accepted` onwards so stores see the driver approach.

| Route | Content |
| --- | --- |
| `onboarding/account → profile → vehicle → attest → verify-phone → pending` | Profile: name, **city** chips (`CITIES`). Vehicle: type chips (Car/sedan, SUV, Pickup, Cargo van, Box truck, Flatbed, Dump truck, Other), make, model, year, plate (hint "e.g. CBKX 214"), colour, pickup box (5.5 / 6.5 / 8 ft), payload (optional), extras chips (Trailer, Roof rack, Liftgate, Ramps/dolly). Attest: valid licence, valid insurance, and "I'm responsible for the load from pickup until the delivery photo". No document images are stored. Pending: "We'll call to confirm your licence, insurance and payout setup." |
| `(tabs)/jobs` | Online toggle banner ("Go online to see jobs near you"). Board: `jobOffers where status == 'open' and audience array-contains '{cityId}:{capacityClass}' orderBy openedAt desc` (index 19), sorted by ready time then distance from the driver. Card: **$47.75**, class badge, "Kestrel Lumber Yard · Etobicoke → Leslieville · M4M · 26.0 km", "Ready 12:50 pm · deliver by 1:50 pm" or "Fri 7–9 am", load "20 × 2x4x8 SPF stud, 4 × OSB 7/16 in · 182 kg · longest 8 ft · sheets", unloading ("Site crew helps" / "Labourer meets you" / "Unattended: photo drop"). "Not for me" hides it locally. Filter chips: Ready now, Scheduled, Near me. |
| `job/[id]` | Offer detail: map (store pin, approximate site circle), load list, payout breakdown (base, distance, load, handling, boost), window, unloading info. **Accept job** (`claimJob`); losing a race shows "Someone else just took this job". |
| `(tabs)/index` Today | Active jobs as two-stop cards: ① store (ready ✓ / "Being prepared, ready by 12:50 pm") ② site. Assignments from dispatch (accept/decline) as today. |
| `delivery/[id]` | Stepper **To store → At store → Loaded → To site → At site → Done**. Store block (address, hours, phone, loading notes, navigate). **I'm at the store** (`checkInAtStore`). **PIN card** "Show this PIN at the counter: 4831" (the store confirms the collection; the screen updates live). Load checklist (ticks on the device). Site block, shown after the claim: address, site contact (call/text), instructions, receiving, max vehicle. Unloading note (labourer booked with name / site crew helps / heavy and nobody on site → call ops). Actions: Release job (before collection, reason), Start trip to site, I've arrived, Complete, Report a problem (after collection). |
| `delivery/[id]/complete` | **Drop-off photo (required)**, hand-off code when attended, recipient name (optional), note. COD removed. |
| `delivery/[id]/fail` | `FAILURE_REASONS` (§2.3). |
| `(tabs)/route` | Planned route with pickup stops (store icon) and drop-off stops (`RouteStop.kind`, §5.11); a job's pickup always comes before its drop-off. |
| `(tabs)/earnings` | Today and this week, unpaid balance, entries (delivery with its wait and boost parts from `delivery.payout`, failed attempt, cancellation, clawback), daily payouts with references. |
| `(tabs)/chat` | Dispatch chat with the construction quick replies (§2.3). |
| `profile`, `vehicle`, `history`, `notifications` | Profile (city read-only — change via support). Vehicle: approved vehicle and capacity class (set by ops); edits submit `updateDriverVehicle` and show "Pending review" until approved. |

---

## 11. Seed data (`scripts/seed.ts`, `scripts/data/*.ts`; K)

Everything is fictional. Business names are invented (none of the site's examples — Maple Building
Supply, BuildCo, Northside Reno, R. Mehta, A. Singh, … — are reused); check them against real GTA
businesses before any public demo. Addresses are **intersections**, never civic numbers. Phones use
the reserved NANP fictional range 555-0100…0199. Emails end in `@instasupply.test`. Password
`Instasupply@123`. OTP test numbers `+14165550199`, `+16475550199`, `+19055550199` accept `123456`.
Dev support line `+1 416 555 0100`.

Data files: `scripts/data/categories.ts` (§1.5), `stores.ts`, `products.ts`, `accounts.ts`,
`jobsites.ts`, `scenarios.ts`. Accounts, categories, stores, products, jobsites, cards and seed
reviews are written with the Admin SDK (products then pass through `onProductWritten`); every
**order, quote, issue and status change goes through the real callables**, so seeding is also an
end-to-end smoke test. Expected totals are computed with `priceCheckout` from the same documents.
Time-dependent steps use `runJobNow`. A scenario uses ASAP when every store in it can do ASAP now,
otherwise the earliest valid window, so the seed works at any time of day (amounts never depend on
time).

### 11.1 Accounts

| Email | Role | Details |
| --- | --- | --- |
| admin@ | admin | Morgan Lee |
| dispatch@ | dispatcher | Riley Chen |
| customer@ | customer | **Dana Whitfield**, Whitfield Renovations, contractor, +1 416 555 0110 (verified). Cards: Visa ••4242 (default), Mastercard ••4444, "Test decline" Visa ••0002. Jobsites: 3 (§11.2) |
| homeowner@ | customer | **Sam Okafor**, homeowner, +1 437 555 0144 (verified), Visa ••4242, jobsite "Home — Danforth". **No orders** (first-order perks show) |
| kestrel@ · kestrel.staff@ | supplier owner · staff | Owen Mercer · Jas Dhillon (Kestrel Lumber Yard) |
| grainline@, bluestone@, voltway@, copperline@, aircrest@, boltbin@, glassmoor@, casingcraft@, slatebridge@ | supplier owners | Priya Anand, Nadia Petrov, Ken Ito, Maria Santos, Hamid Karimi, Chris Doyle, Elena Rossi, Victor Lam, Fiona Walsh |
| marco@ | driver | Marco Bellini · toronto · pickup Ford F-150 2021 white, 6.5 ft box, CBKX 214 → **pickup** · online at 43.7000, −79.5600 · +1 416 555 0151 |
| aisha@ | driver | Aisha Rahman · toronto · Ford Transit 250 2022 white, DMRT 538 → **cargo_van** · online at 43.7615, −79.4111 · +1 647 555 0152 |
| tom@ | driver | Tom Nguyen · toronto · Toyota Corolla 2019 grey, CAPW 771 → **car** · offline at 43.7731, −79.2577 · +1 437 555 0153 |
| gurpreet@ | driver | Gurpreet Sandhu · brampton · Isuzu NPR 2020 flatbed (16 ft deck), AK 41927 → **flatbed** · online at 43.7200, −79.7000 · +1 905 555 0154 |
| devon@ | driver | Devon Clarke · toronto · Hino 195 2020 16 ft box with liftgate, AM 52038 → **box_truck** · online at 43.6500, −79.4500 · +1 416 555 0155 |
| new.driver@ | driver (pending) | Lena Kowalski · mississauga · Honda CR-V 2020, CNLT 902 → suv · attested, not verified |

Active drivers have `compliance.licenceVerified = insuranceVerified = true` and claims `{cityId, capacityClass}`.

### 11.2 Jobsites

| Owner | Label | Address | Pin | City · area | Site contact | Receiving | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dana (default) | Leslieville semi reno | Pape Ave & Dundas St E, Toronto ON M4M 2E3 | 43.6648, −79.3405 | toronto · Leslieville · M4M | Dana Whitfield +1 416 555 0110 | attended | "Laneway access off Pape. Stack lumber under the tarp by the garage." |
| Dana | Junction basement | Dundas St W & Keele St, Toronto ON M6P 1Z2 | 43.6655, −79.4636 | toronto · The Junction · M6P | Luis Ortega +1 647 555 0141 | unattended | "Side door code 4410. Drywall inside the side door." Max vehicle: cargo_van |
| Dana | Mimico laneway house | Royal York Rd & Lake Shore Blvd W, Toronto ON M8V 1L4 | 43.6163, −79.4955 | toronto · Mimico · M8V | Dana Whitfield | attended | "Lane behind the house; park on the gravel pad." |
| Sam (default) | Home — Danforth | Danforth Ave & Woodbine Ave, Toronto ON M4C 1L9 | 43.6866, −79.3127 | toronto · Danforth · M4C | Sam Okafor +1 437 555 0144 | attended | — |

### 11.3 Stores

Hours are Mon–Fri / Sat / Sun. "Prep · cut-off · radius · commission". Live stores accept orders;
Glassmoor is also closed 2026-11-27 (stock-take). Seed reviews (Admin SDK, ids `seed-{storeId}-{n}`)
give the ratings shown. Every store's `imageKey` is its specialty's `store-*` art (§12.7), and its
`alertPhone` is its own 555 number, so the new-order SMS shows up in the dev outbox.

| id | Name | Specialty | Address · city (area) | Pin | Phone | Status | Hours | Prep · cut-off · km · bps | Seed rating |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kestrel-lumber | Kestrel Lumber Yard | lumber_building | Dixon Rd & Martin Grove Rd, M9W 5L4 · toronto (Etobicoke) | 43.6966, −79.5752 | +1 416 555 0120 | live | 06:30–18:00 / 07:00–16:00 / closed | 25 · 15:00 · 45 · 900 | 4.8 (5) |
| grainline-building | Grainline Building Centre | lumber_building | Kennedy Rd & Ellesmere Rd, M1P 2L7 · toronto (Scarborough) | 43.7655, −79.2829 | +1 416 555 0121 | live | 07:00–19:00 / 08:00–17:00 / 10:00–16:00 | 20 · 15:00 · 40 · 900 | 4.5 (4) |
| bluestone-drywall | Bluestone Drywall & Paint | drywall_paint | Keele St & Finch Ave W, M3J 2N6 · toronto (North York) | 43.7709, −79.4912 | +1 416 555 0122 | live | 06:30–17:00 / 07:00–13:00 / closed | 20 · 15:00 · 40 · 1000 | 4.8 (5) |
| voltway-electrical | Voltway Electrical Supply | electrical | Dixie Rd & Eglinton Ave E, L4W 1N6 · mississauga | 43.6262, −79.6143 | +1 905 555 0123 | live | 07:00–17:30 / 08:00–13:00 / closed | 15 · 15:30 · 40 · 1000 | 4.7 (3) |
| copperline-plumbing | Copperline Plumbing Depot | plumbing | Keele St & Hwy 7, L4K 4N4 · vaughan (Concord) | 43.8010, −79.4990 | +1 905 555 0124 | live | 07:00–17:00 / 08:00–14:00 / closed | 15 · 15:00 · 40 · 1000 | 4.8 (4) |
| aircrest-hvac | Aircrest HVAC & Refrigeration | hvac_refrigeration | Denison St & Woodbine Ave, L3R 9W8 · markham | 43.8306, −79.3598 | +1 905 555 0125 | live | 07:30–16:30 / closed / closed | 20 · 14:00 · 35 · 1000 | 4.3 (3) |
| boltbin-hardware | Boltbin Fasteners & Hardware | fasteners_hardware | Torbram Rd & Steeles Ave E, L6T 4X7 · brampton | 43.7262, −79.6885 | +1 905 555 0126 | live | 07:00–18:00 / 08:00–15:00 / closed | 10 · 16:00 · 45 · 1100 | 4.8 (5) |
| glassmoor-glass | Glassmoor Glass & Mirror | glass_mirrors | Laird Dr & Eglinton Ave E, M4G 3V6 · toronto (Leaside) | 43.7102, −79.3615 | +1 416 555 0127 | live | 08:00–17:00 / 09:00–13:00 / closed | 30 · 14:00 · 30 · 1200 | 4.3 (3) |
| casingcraft-doors | Casingcraft Doors & Trim | doors_trims | West Beaver Creek Rd & Hwy 7, L4B 1H1 · richmond_hill | 43.8470, −79.3990 | +1 905 555 0128 | live | 07:30–17:00 / 08:00–14:00 / closed | 30 · 14:30 · 40 · 1000 | 4.5 (4) |
| slatebridge-masonry | Slatebridge Masonry & Roofing | masonry_roofing | Speers Rd & Kerr St, L6K 2G2 · oakville | 43.4441, −79.6880 | +1 905 555 0129 | live | 06:30–17:00 / 07:00–13:00 / closed | 25 · 14:00 · 45 · 900 | 4.7 (3) |
| quietcore-insulation | Quietcore Insulation Supply | insulation_soundproofing | Brock Rd & Bayly St, L1W 3H9 · pickering | 43.8290, −79.0870 | +1 905 555 0130 | onboarding | — | — | — |
| tapstone-bath | Tapstone Bath & Fixtures | bath_fixtures | Hurontario St & Dundas St, L5A 2C1 · mississauga (Cooksville) | 43.5890, −79.6230 | +1 905 555 0132 | coming_soon | — | — | — |
| brightrafter-lighting | Brightrafter Lighting | designer_lighting | King St W & Bathurst St, M5V 1J5 · toronto (King West) | 43.6440, −79.4030 | +1 416 555 0133 | coming_soon | — | — | — |
| cabinetwell-kitchens | Cabinetwell Kitchens | kitchen_cabinets | Jane St & Langstaff Rd, L4K 2M5 · vaughan (Concord) | 43.8170, −79.5220 | +1 905 555 0134 | coming_soon | — | — | — |

Road km from these pins to the jobsites (used by the vectors): Leslieville — Kestrel 26.0, Bluestone
22.9, Boltbin 38.9, Voltway 30.4, Grainline 16.4, Glassmoor 7.2; Mimico — Slatebridge 33.3,
Kestrel 14.9, Boltbin 26.7.

### 11.4 Products (80; every category covered)

Columns: SKU · name · category · unit · size · price · on hand · kg · l×w×h cm · art key. **Family
keys** (cross-store): `spf-2x4x8` (KLY/GBC-SPF248), `drywall-12-4x8` (BDP/GBC-DW12), `joist-hanger-2x8`
(KLY/BFH-JH28), `subfloor-screws-212-5lb` (KLY/BFH-SCR212), `const-adhesive-300ml` (KLY/BFH-ADH);
all others `null`. Art keys reuse the existing SVGs; "—" falls back to the category icon.

**Kestrel Lumber Yard (12):** KLY-SPF248 2x4x8 SPF stud, kiln-dried · wood · each · 2 in × 4 in × 8 ft ·
$4.79 · 1 200 · 4.5 · 244×9×4 · lumber-stud | KLY-PT2612 Pressure-treated 2x6, 12 ft · wood · each ·
$18.98 · 300 · 14 · 366×14×4 · lumber-pt | KLY-PT448 Pressure-treated 4x4 post, 8 ft · outdoors · each ·
$16.98 · 150 · 15 · 244×9×9 · lumber-pt | KLY-OSB716 OSB sheathing 7/16 in, 4×8 · wood · sheet · $22.98 ·
260 · 23 · 244×122×1.1 · osb-sheet | KLY-PLY12 Plywood CDX 1/2 in, 4×8 · wood · sheet · $42.98 · 180 ·
18.6 · 244×122×1.3 · plywood-sheet | KLY-SUB34 T&G OSB subfloor 3/4 in, 4×8 · wood · sheet · $39.98 · 120
· 30 · 244×122×1.9 · plywood-sheet | KLY-IJ916 I-joist 9-1/2 in, 16 ft · wood · each · $64.98 · 60 · 22
· 488×24×6 · i-joist | KLY-REBAR Rebar 10M, 20 ft · masonry · length · $12.98 · 300 · 4.8 ·
610×1.2×1.2 · rebar-bundle | KLY-CONC30 Concrete mix, 30 kg · masonry · bag · $9.48 · 400 · 30 ·
60×40×12 · concrete-mix-bag | KLY-ADH Construction adhesive, 300 ml · adhesives · tube · $6.98 · 240 ·
0.4 · 25×6×6 · construction-adhesive | KLY-SCR212 Subfloor screws #9 × 2-1/2 in, 5 lb · fasteners · box
· $34.98 · 90 · 2.4 · 18×12×8 · screws-box | KLY-JH28 Joist hanger 2x8, galvanized · fasteners · each ·
$2.98 · 600 · 0.3 · 15×8×5 · joist-hanger

**Grainline Building Centre (12):** GBC-SPF248 2x4x8 SPF stud · wood · each · $4.98 · 800 · 4.5 ·
244×9×4 · lumber-stud | GBC-DW12 Drywall 1/2 in regular, 4×8 · drywall · sheet · $18.98 · 400 · 25 ·
244×122×1.3 · drywall-sheet | GBC-R20 Fibreglass batts R20, 15 in (78.3 sq ft) · insulation · bag ·
$72.98 (compare $79.98) · 120 · 9 · 120×40×40 · insulation-batts | GBC-XPS2 XPS rigid foam 2 in, 2×8 ft
· insulation · sheet · $36.98 · 140 · 2.7 · 244×61×5 · rigid-foam-board | GBC-POLY6 6 mil vapour
barrier, 10 × 100 ft · insulation · roll · $89.98 · 60 · 13 · 125×25×25 · vapour-barrier | GBC-FOAM
Spray foam, low expansion, 340 g · insulation · can · $11.98 · 300 · 0.45 · 25×7×7 · spray-foam |
GBC-LVP Luxury vinyl plank 6 mm (20 sq ft) · flooring · box · $59.98 · 150 · 15 · 122×20×10 ·
laminate-planks | GBC-TAPE25 Tape measure, 25 ft · tools · each · $19.98 · 80 · 0.4 · 10×10×5 ·
tape-measure | GBC-HAT Hard hat, Type 1 Class E · safety · each · $24.98 · 100 · 0.4 · 30×25×15 ·
hard-hat | GBC-VEST Hi-vis vest, CSA Class 2 · safety · each · $14.98 · 150 · 0.2 · 30×25×3 ·
hi-vis-vest | GBC-BAGS Contractor bags 42 gal, 20-pack · cleaning · pack · $24.98 · 120 · 2 · 30×25×10
· contractor-bags | GBC-RANGE 30 in electric range, stainless · appliances · each · $899.98 · 6 · 68 ·
120×76×76 · range-stove

**Bluestone Drywall & Paint (10):** BDP-DW12 Drywall 1/2 in regular, 4×8 · drywall · sheet · $18.48 ·
900 · 25 · 244×122×1.3 · drywall-sheet | BDP-DW58X Drywall 5/8 in Type X, 4×8 · drywall · sheet ·
$24.98 · 300 · 31 · 244×122×1.6 · drywall-sheet | BDP-JC17 All-purpose joint compound, 17 L · drywall ·
pail · $29.98 · 150 · 28 · 30×30×38 · joint-compound | BDP-CB8 Metal corner bead, 8 ft · drywall ·
length · $3.98 · 500 · 0.5 · 244×3×3 · corner-bead | BDP-TAPE Paper drywall tape, 500 ft · drywall · roll
· $8.98 · 200 · 0.6 · 15×15×5 · drywall-tape | BDP-PAINT Interior paint, eggshell white, 3.78 L · paint
· can · $64.98 (compare $74.98) · 140 · 5.2 · 20×20×20 · paint-can | BDP-PRIME Drywall primer-sealer,
3.78 L · paint · can · $44.98 · 160 · 5.4 · 20×20×20 · paint-can | BDP-ROLL 9 in roller kit · paint · kit
· $19.98 · 200 · 0.9 · 45×25×8 · paint-roller-kit | BDP-PTAPE Painter's tape, 48 mm × 55 m · paint · roll
· $8.98 · 300 · 0.2 · 10×10×5 · painters-tape | BDP-SLAT Acoustic slat wall panel, 94.5 × 24 in ·
wall-decor · each · $119.98 · 40 · 12 · 240×61×2 · —

**Voltway Electrical Supply (6):** VES-NMD142 NMD90 14/2 cable, 75 m · electrical · roll · $119.98 · 80 ·
7 · 35×35×12 · cable-coil | VES-EMT12 EMT conduit 1/2 in, 10 ft · electrical · length · $9.98 · 400 ·
1.2 · 305×2×2 · emt-conduit | VES-BOX Single-gang PVC device box · electrical · each · $1.48 · 1 000 ·
0.05 · 10×6×6 · electrical-box | VES-REC Decora receptacle 15 A, 10-pack · electrical · pack · $24.98 ·
150 · 0.9 · 20×12×8 · receptacle | VES-BRK 15 A single-pole breaker · electrical · each · $14.98 · 200 ·
0.15 · 10×3×8 · breaker | VES-POT 4 in slim LED pot light, 4-pack · electrical · pack · $49.98 · 90 · 1.2
· 25×25×8 · pot-light

**Copperline Plumbing Depot (9):** CPD-CU34L Copper pipe 3/4 in Type L, 12 ft · plumbing · length ·
$96.98 · 60 · 2.5 · 366×2.2×2.2 · copper-pipe | CPD-PEX12 PEX-A pipe 1/2 in, 100 ft coil · plumbing ·
roll · $79.98 · 70 · 2.6 · 45×45×8 · pex-coil | CPD-ABS3 ABS DWV pipe 3 in, 12 ft · plumbing · length ·
$39.98 · 90 · 6 · 366×9×9 · abs-pipe | CPD-ABS90 ABS elbow 3 in, 90° · plumbing · each · $6.98 · 300 ·
0.2 · 12×12×9 · abs-pipe | CPD-BV12 Brass ball valve 1/2 in, sweat · plumbing · each · $18.98 · 150 · 0.3
· 10×6×6 · ball-valve | CPD-CEM ABS cement, 473 ml · adhesives · can · $12.98 · 100 · 0.6 · 10×10×14 · —
| CPD-TOILET Two-piece elongated toilet, 4.8 Lpf · bath · each · $249.98 · 25 · 40 · 75×45×80 · toilet |
CPD-FAUCET Pull-down kitchen faucet, stainless · kitchen · each · $149.98 · 30 · 3.5 · 45×25×12 ·
bath-faucet | CPD-WH40 Electric water heater, 40 gal · appliances · each · $749.98 · 8 · 50 · 150×55×55 · —

**Aircrest HVAC & Refrigeration (4):** AHR-DUCT6 Galvanized duct pipe 6 in, 5 ft · hvac · length ·
$14.98 · 200 · 1.6 · 152×15×15 · — | AHR-FLEX6 Insulated flex duct 6 in, 25 ft · hvac · each · $39.98 ·
60 · 2.5 · 40×40×30 · flex-duct | AHR-FILTER Furnace filter MERV 11, 16×25×1 in · hvac · each · $24.98 ·
120 · 0.6 · 64×41×3 · hvac-filter | AHR-FAN80 Bathroom exhaust fan, 80 CFM · hvac · each · $89.98 · 40 ·
3.2 · 30×30×20 · —

**Boltbin Fasteners & Hardware (11):** BFH-JH28 Joist hanger 2x8, galvanized · fasteners · each · $2.79
· 900 · 0.3 · 15×8×5 · joist-hanger | BFH-DECK Deck screws #10 × 2-1/2 in, 5 lb · fasteners · box ·
$34.98 · 150 · 2.4 · 18×12×8 · screws-box | BFH-NAILS Framing nails 3-1/4 in, 5 kg · fasteners · box ·
$42.98 · 80 · 5 · 25×15×12 · framing-nails | BFH-SCR212 Subfloor screws #9 × 2-1/2 in, 5 lb ·
fasteners · box · $33.48 · 140 · 2.4 · 18×12×8 · screws-box | BFH-ANCHOR Drywall anchors with screws,
50-pack · fasteners · pack · $12.98 · 200 · 0.4 · 15×10×4 · wall-anchors | BFH-BOLTS Hex bolts and nuts
3/8 × 4 in, 25-pack · hardware · pack · $18.98 · 120 · 1.6 · 15×10×6 · bolts-nuts | BFH-HINGE Door
hinges 3-1/2 in, satin nickel, 3-pack · hardware · pack · $9.98 · 200 · 0.6 · 12×10×4 · door-hinge |
BFH-ADH Construction adhesive, 300 ml · adhesives · tube · $6.49 · 400 · 0.4 · 25×6×6 ·
construction-adhesive | BFH-GLOVES Insulated work gloves, L · safety · pair · $12.98 · 200 · 0.2 ·
25×12×3 · work-gloves | BFH-DRILL 20 V cordless drill/driver kit · tools · kit · $179.98 · 15 · 2.8 ·
40×30×12 · cordless-drill | BFH-TOOLBOX Contractor tool box, 26 in · storage · each · $49.98 · 20 · 3 ·
66×30×28 · tool-box

**Glassmoor Glass & Mirror (4):** GGM-MIRROR Bevelled mirror, 24 × 36 in · glass · each · $89.98 · 20 ·
9 · 91×61×3 · wall-mirror | GGM-SHELF Tempered glass shelf, 8 × 24 in · glass · each · $34.98 · 40 · 2 ·
61×20×1 · glass-sheet | GGM-SHOWER Frameless shower door, 30 × 72 in · bath · each · $449.98 · 6 · 38 ·
183×76×5 · — | GGM-CAULK Clear silicone sealant, 300 ml · adhesives · tube · $9.49 · 200 · 0.35 ·
25×6×6 · silicone-caulk

**Casingcraft Doors & Trim (6):** CDT-BASE Primed MDF baseboard 5-1/4 in, 12 ft · wall-decor · length ·
$16.98 · 200 · 2.4 · 366×13×1.5 · mdf-baseboard | CDT-CASE Primed MDF casing 2-3/4 in, 7 ft ·
wall-decor · length · $7.98 · 400 · 1.1 · 213×7×1.5 · mdf-baseboard | CDT-DOOR30 Prehung interior door
30 × 80 in, shaker · doors · each · $219.98 · 25 · 25 · 210×86×12 · interior-door | CDT-EXT36 Steel
exterior door 36 × 80 in, prehung · doors · each · $499.98 · 8 · 45 · 210×100×15 · — | CDT-WIN Vinyl
slider window, 36 × 24 in · windows · each · $289.98 · 12 · 14 · 95×65×10 · window-unit | CDT-CAB24
Base cabinet 24 in, shaker white · kitchen · each · $289.98 · 10 · 32 · 90×65×62 · base-cabinet

**Slatebridge Masonry & Roofing (6):** SMR-SHING Architectural shingles, bundle (32.8 sq ft) · roofing ·
bundle · $49.98 · 600 · 30 · 100×33×13 · shingles-bundle | SMR-UNDER Synthetic underlayment, 10 squares
· roofing · roll · $139.98 · 40 · 12 · 107×25×25 · roofing-underlayment | SMR-ICE Ice & water shield, 2
squares · roofing · roll · $109.98 · 45 · 19 · 95×25×25 · roofing-underlayment | SMR-MORTAR Type S mortar
mix, 30 kg · masonry · bag · $14.98 · 300 · 30 · 60×40×12 · cement-bag | SMR-BLOCK Concrete block 8 in
· masonry · each · $3.98 · 1 200 · 17 · 39×19×19 · bricks-stack | SMR-SLAB Patio slab 24 × 24 in,
charcoal · outdoors · each · $11.98 · 400 · 30 · 61×61×5 · patio-pavers

Badges: bestseller KLY-SPF248, BDP-DW12 · deal BDP-PAINT, GBC-R20 · new BDP-SLAT. Featured:
KLY-SPF248, GBC-SPF248, BDP-DW12, SMR-SHING, GBC-FOAM, CPD-CU34L, VES-NMD142, BDP-PAINT, BFH-JH28,
KLY-OSB716. Descriptions: one or two trade-style sentences each, written in `products.ts`.

### 11.5 Scenarios (run in this order; numbers are the §3.11 vectors)

| # | What | Steps (callables unless noted) | Expected end state |
| --- | --- | --- | --- |
| A | Dana's **first order**, delivery to Leslieville (attended), labourer for Kestrel, Visa ••4242 — **V1** | `placeOrder` (Bluestone 6 × BDP-DW12 + 1 × BDP-JC17; Kestrel 20 × KLY-SPF248 + 4 × KLY-OSB716) → both stores accept → preparing → ready → offers open (`runJobNow('publishDueJobOffers', opensAt)` if scheduled) → Aisha claims Bluestone, Marco claims Kestrel → `checkInAtStore` → stores `completePickup` with each driver's PIN → in transit → arrived → `completeDelivery` (seeded proof photo in the Storage emulator + hand-off code read with the Admin SDK) → Dana rates Kestrel 5★ → `runJobNow('runDailyPayouts')` → `reportIssue` CASE-10001 on Bluestone ("2 sheets cracked at the corner", damaged, 2 × drywall, 1 photo) | IS-10001 completed, captured **38 825**; payouts Kestrel 17 083, Bluestone 12 677, Marco 4 775, Aisha 4 200; CASE-10001 open (resolving it in the demo refunds **3 922** and claws back 3 326 — V5) |
| B | Dana's **live order**, Leslieville, BUILD25, labourer for Kestrel — **V3/V4** | `placeOrder` (Boltbin 24 × BFH-JH28 + 2 × BFH-DECK; Kestrel 24 × KLY-SPF248 + 6 × KLY-OSB716; Voltway 3 × VES-NMD142 + 20 × VES-BOX) → Kestrel accepts → ready → Marco claims → check-in → `completePickup` → in transit; Boltbin accepts with joist hangers 24 → 20 (`out_of_stock`) → preparing; Voltway left `new` | IS-10002 placed 89 191, current 87 970; Kestrel out for delivery (run `npm run simulate -- --driver marco@instasupply.test`); Boltbin preparing; Voltway new (portal alert, escalation demo) |
| C | Dana **pickup** at Copperline — **V6** | `placeOrder` (pickup: 4 × CPD-CU34L + 6 × CPD-BV12) → accept → ready | IS-10003-A ready, PIN printed by the seed, total 56 703, held until next business-day close |
| D | Dana **scheduled** delivery, Grainline → Leslieville | `placeOrder` (20 × GBC-R20 + 10 × GBC-XPS2) in the first valid window whose offer opens in the future → accept | IS-10004-A accepted; offer `scheduled`, cargo van, payout 4 550; items 182 940 (free delivery), total 206 722 |
| E | **Open job** for the board, Slatebridge → Mimico (attended) | `placeOrder` (20 × SMR-SHING + 2 × SMR-UNDER) → accept → `runJobNow('publishDueJobOffers', opensAt)` if needed | IS-10005-A offer `open`, pickup class, payout 6 350, total 144 590. Visible to Marco, Aisha, Devon (toronto, ≥ pickup); **not** Tom (car) and **not** Gurpreet (brampton) |
| F | Quote **Q-10001 submitted** | `submitMaterialList`: Junction basement, needed this week, delivery, prefers a call; lines "2x4x8 SPF studs — 60", "1/2 in drywall 4x8 — 30", "R12 batts for 2x4 walls — 8 bags", "Vapour barrier 10 × 100 — 1", "Joint compound 17 L — 3", "Corner bead 8 ft — 12"; attachment `framing-list.png` | in the ops inbox with its 30-min SLA |
| G | Quote **Q-10002 quoted** | `submitMaterialList` (Mimico, 4 lines) → dispatch `sendQuote`: Kestrel 30 × KLY-PT2612 @ $17.98 (list $18.98), 8 × KLY-PT448 @ $15.98 (list $16.98), 2 × custom "LVL beam 1-3/4 × 9-1/2 in × 14 ft (special order)" @ $189.00 (27 kg, 427×24×5); Boltbin 3 × BFH-DECK @ $34.98; valid 48 h | quoted, total **129 970 ($1,299.70)**: Kestrel 118 112 (box truck, payout 7 850), Boltbin 11 858; free delivery; Dana can accept it |
| H | Support | Dana ↔ dispatch thread about IS-10002 (2 messages, context chip); Kestrel store thread ↔ ops ("Please update our Saturday hours") | summaries and unread counts via the trigger |
| I | Store suggestions | `suggestStore`: "Harbourline Tile Gallery" (Toronto; Flooring & Tile, Kitchen & Bath; by Sam), "Fernhill Steel & Rebar" (Vaughan; Steel & Rebar; no email) | 2 suggestions `new` |
| K | A **rejected** order | `placeOrder` (Glassmoor 1 × GGM-MIRROR, Leslieville) → Glassmoor rejects (`out_of_stock`) | IS-10006 cancelled, authorization 11 636 voided, mirror available 0 |

Sam has no orders (scenario J). The seed prints the accounts, the portal URL, B's Kestrel tracking
link, C's PIN and the simulator command. `scripts/simulate-driver.ts` drives to the store first,
calls `checkInAtStore`, waits for `ready`, performs the hand-over as the store owner with the PIN
(`--auto-handover`, default on in the emulator), drives to the site, uploads a placeholder photo and
completes with the hand-off code. Default start position: Toronto (43.6532, −79.3832).

---

## 12. Migration: what to delete, rename or rewrite

No data migration: the grocery build has no production customers. Staging (and, before launch,
production) is recreated in `northamerica-northeast2` (D13) and reseeded; delete the local
`.emulator-data/`.

### 12.1 `packages/shared` (A)
- **Delete:** `commerce.ts` (content moves per §1.3); `CURRENCY = 'INR'`; `FREE_DELIVERY_THRESHOLD`,
  `DELIVERY_FEE`, `PROMOS` FIRST20/FRESH10, float `roundMoney`, `priceCart`; `PaymentMethod`,
  payment statuses `cod_pending`/`collected`/`refund_pending`; badge `organic`; `price`/`mrp` floats
  (→ `priceCents`/`compareAtCents`); `Review` (product); `OrderStatus` `packed`, `orderStatusForDelivery`,
  `ORDER_PROGRESS`, `canCustomerCancel`; `Address`, `AddressFields`, `validateAddressFields`,
  `formatAddress`; card brand `rupay`; `VehicleType` bike/scooter/van/truck, `Vehicle`, `VEHICLE_META`;
  `DEFAULT_COUNTRY_CODE = '+91'`; `formatCurrency`; `codAmount` (Delivery, DeliveryInput), `codCollected`
  (DeliveryProof, CompleteDeliveryRequest); `PlaceOrderRequest.addressId/paymentMethod`;
  `MAX_QUANTITY_PER_LINE = 20`, `MAX_CART_LINES = 50`; `COLLECTIONS.addresses`. (Keep
  `COLLECTIONS.reviews`: it now names the store-review subcollection under `stores`.)
- **Replace:** `normalizePhone` → NANP only (10 digits, `1` + 10, `+1…`; rejects other countries),
  `formatPhone` `(416) 555-0110`, `maskPhone`; `normalizePostalCode`, `isOntarioPostalCode`;
  `formatMoney`/`formatFee`; ET time helpers (§4.1); `DEFAULT_CITY_SPEED_KMH` 24 → 36 (GTA estimate);
  failure/decline reasons and quick replies (§2.3); new modules per §1.3; `CALLABLES`,
  `COLLECTIONS`, `NotificationType`, `ERROR_CODES`; `optimizeStops` precedence (`OptimizerStop.after`,
  §5.11). `DEFAULT_FUNCTIONS_REGION` stays `us-central1` (D13).
- **Tests:** `domain.test.ts` phone vectors become +1; `commerce.test.ts` is replaced (§13.1).

### 12.2 Functions (B, C, D, E)
- Delete `modules/commerce/order-sync.ts` (→ projections + `order-aggregate.ts`) and
  `modules/commerce/reviews.ts` (→ `modules/stores/reviews.ts`). Rewrite `place-order.ts`,
  `cancel-order.ts`. Remove COD from `deliveries/delivery-writer.ts`, `update-status.ts`,
  `create-deliveries.ts`.
- `config/runtime.ts`: `paymentsMode` `test | stripe | disabled`, `allowTestJobs`, `hstNumber`; rate-limit
  subjects are HMACs keyed with the existing `OTP_PEPPER` secret (no new secret).
  `lib/guards.ts`: role list gains `supplier`. `lib/users.ts` `vehicleLabel` from `DriverVehicle`.
  `routing/planner.ts`, `tracking/tracking-service.ts`: `VEHICLE_META` → `VEHICLE_CLASSES`, pickup
  stops (§5.11) and phases. `geocoding/geocoder.ts`: open to all callers with rate limits and Canada bias.
- Env: `.env.example` `OTP_TEST_NUMBERS=+14165550199:123456,+16475550199:123456,+19055550199:123456`,
  `PAYMENTS_MODE`, `ALLOW_TEST_JOBS`, `HST_NUMBER` (placeholder); `.env.instasupply-staging` and
  `-prod`: `FUNCTIONS_REGION=northamerica-northeast2`, Canadian OTP test number, `PAYMENTS_MODE`
  (`test` staging, `disabled` prod), `ALLOW_TEST_JOBS` (`true` staging, `false` prod).
- Region everywhere else (D13): the GitHub `staging`/`production` environment variable
  `FUNCTIONS_REGION` (feeds `VITE_FUNCTIONS_REGION` in `deploy.yml`, K), `EXPO_PUBLIC_FUNCTIONS_REGION`
  in the `preview` and `production` profiles of `apps/customer/eas.json` (G) and
  `apps/driver/eas.json` (J), leaving `base` and development on `us-central1`, and the bootstrap
  `FIRESTORE_LOCATION=northamerica-northeast2 ./infra/bootstrap-project.sh <project> northamerica-northeast2`
  (K; create the default Storage bucket in the same region). Run the bootstrap on fresh projects:
  an existing `nam5` database can't be moved.

### 12.3 Rules, indexes, tests (F, B, D)
Delete `/users/{uid}/addresses`, `/products/{id}/reviews`, COD in the delivery staff-edit list, the
driver self-edit of `vehicle`, the three grocery product indexes. Delete
`firebase/tests/commerce.rules.test.ts` (F) and `firebase/tests/commerce-workflow.test.ts` (B). Update
`firestore.rules.test.ts` (F) and `delivery-workflow.test.ts` (D: no COD, +1 phones).

### 12.4 Customer app (G, H)
- Delete routes: `(shop)/(tabs)/favorites.tsx` (G → `saved.tsx`), `product/[id]/reviews.tsx`,
  `product/[id]/write-review.tsx` (G), `checkout/address.tsx`, `checkout/payment.tsx`,
  `orders/index.tsx`, `addresses/index.tsx`, `addresses/edit.tsx` (H).
- Delete or replace: `features/addresses/**` and `features/account/address/**` (H → `features/site`
  hooks + `features/jobsites` editor); `features/catalog/reviews.ts`, `features/product/{ReviewItem,
  RatingSummary, review-stats, ReviewTextArea}` (G; keep `StarPicker` for store ratings);
  `features/checkout/{PaymentMethodTiles, AddressOption, DeliveryAddressCard, StepProgress}` and COD
  in `PaymentSection`, `OrderReceipt` (H); `orders/components/RateItemsCard` → `RateStoreCard`,
  COD/₹ in `order-ui.ts` (H).
- Rewrite copy and money: ₹/FIRST20 in `cart.tsx`, `ProductCard.tsx`, `CartItemRow.tsx`,
  `FreeDeliveryProgress.tsx` (→ order-level $500 meter), `PromoCodeSection.tsx`, `usePromoBanners.ts`,
  `FilterControls.tsx` (organic filter), `ProductInfo.tsx`, `account/format.ts`, `account/card/*`
  (no RuPay; add Discover), `CardOption.tsx`; +91 in `session/components/{PhoneField, phone}.ts`; grocery
  copy in `IntroSlide.tsx`, welcome, `RecentSearches`, `HandoffCodeCard`; `theme/tokens.ts`
  `productBackdrops`; `package.json` description; `.env.example` `EXPO_PUBLIC_SUPPORT_PHONE=+14165550100`.

### 12.5 Back office (I1, I2)
- COD and ₹ in `deliveries/components/{DeliveriesTable, DeliveryFormFields, delivery-form}`,
  `deliveries/detail/{DeliverySummary, EditDeliveryModal, ProofCard}`, `deliveries/import/{ImportCsvModal,
  csv}` (CSV columns `codAmount` removed) (I2).
- `features/orders/*` rewritten for marketplace orders; `PaymentCard`, `OrderBadges`,
  `CancelOrderModal`, `order-format.ts` (rupay), `orders-csv.ts` (₹); `PackingSlip` moves to
  `portal/components/PickSlip.tsx` (I1 creates, I2 deletes the old file) (I2).
- `features/dashboard/{StoreSummary, store-hooks}` deleted (I2). `components/map/BaseMap.tsx`
  `DEFAULT_CENTER` → Toronto (I2). `features/catalog/{product-form, components/ProductFormFields,
  components/ProductParts}`: organic, mrp, ₹ → cents, stock on hand/reserved, weight and size (I1).
- `features/auth/AuthProvider.tsx` accepts suppliers; rejection copy updated (I1).

### 12.6 Driver app (J)
COD in `delivery/[id]/complete.tsx`, `delivery/[id]/index.tsx`, `features/deliveries/{AssignmentCard,
DeliveryCard, actions}`; bike/scooter chips and the `KA01AB1234` placeholder in `VehicleFields.tsx`;
+91 hint in `onboarding/verify-phone.tsx`; grocery copy in onboarding; `(tabs)/profile.tsx` →
`(app)/profile.tsx`.

### 12.7 Scripts, art, docs, CI (K)
- `scripts/data/catalog.ts` → the six data files (§11); `seed.ts` rewritten; `simulate-driver.ts`
  pickup leg; `import-catalog.ts` → categories now, `--store <id> file.csv` **P1**;
  `scripts/lib/emulator.ts` unchanged (D13).
- **Art** (`packages/art/svg`, 171 files on 2026-11-19 evening): delete the 45 grocery files — apple,
  avocado, baby-lotion, banana, bell-pepper, bread, broccoli, carrot, cheese, coconut-water, cold-coffee, cucumber, detergent,
  diapers, dish-soap, eggs, grapes, green-tea, lemon, mango, milk, olive-oil, onion, orange-juice,
  orange, peach, pineapple, pomegranate, potato, rice, spinach, strawberry, sunflower-oil, tissue-roll,
  tomato, watermelon, cat-babycare, cat-beverages, cat-edible-oil, cat-fruits, cat-grocery,
  cat-household, cat-vegetables, hero-basket, hero-fruits. **Keep** the 73 construction product SVGs,
  all **25** construction `cat-*` icons (the 15 that were missing are now drawn), the 10 `scene-*`
  scenes (welcome, local-suppliers, live-tracking, material-list, pickup-ready, order-confirmed,
  jobsite-delivery, empty-cart, report-issue, support), the 10 `store-*` storefronts, `brand-mark` and
  `mark`. The apps use the `scene-*` keys (intro slides, empty states, order success, issue and support
  screens) instead of the six remaining `hero-*` scenes (delivery, discount, empty-cart, order-success,
  promo, welcome), which are deleted once nothing references them. Store art by specialty
  (`STORE_SPECIALTY_ART` in `catalog.ts`, A): lumber_building → store-lumber, drywall_paint →
  store-drywall-paint, electrical and designer_lighting → store-electrical, plumbing → store-plumbing,
  hvac_refrigeration → store-hvac, fasteners_hardware → store-hardware, glass_mirrors and doors_trims →
  store-doors-windows, kitchen_cabinets and bath_fixtures → store-kitchen-bath,
  insulation_soundproofing → store-roofing-insulation, masonry_roofing → store-masonry. Run the art
  build: `src/generated.ts` is stale today (16 keys for 171 SVGs). `ArtImage` falls back to the
  category icon for a null or unknown key.
- **Docs:** README, ARCHITECTURE and DEPLOYMENT describe the marketplace, the Toronto region, payments
  modes (Stripe Canada later), Twilio Canadian numbers, CASL opt-in, PIPEDA notes and the HST number.
- **Legacy grep (CI step `npm run check:legacy`):** none of `₹`, `INR`, `+91`, `rupay`, `organic`,
  `codAmount`, `codCollected`, `cod_pending`, `grocer`, `Bengaluru`, `FIRST20`, `FRESH10`,
  `asia-south1`, `KA01` may appear outside `docs/MARKETPLACE.md` (the grep skips `node_modules`, lock
  files, `.emulator-data` and emulator logs; test vectors use other non-NANP numbers such as `+44…`).

---

## 13. Test plan

### 13.1 Unit tests (`packages/shared/test`, `node:test` via tsx; A)

| File | Cases |
| --- | --- |
| `money.test.ts` | `mulDivHalfUp` and `percentBps` at …49/…50; `allocate` sums and tie order; `ceilTo25`; `formatMoney` (thousands, negatives) and `formatFee` |
| `vehicles.test.ts` | each class limit at and above the boundary (150/150.001 kg, 250/251 cm, 4×8 sheet forces pickup, 2 500/2 501 L); `summarizeLoad` on V1/V3/scenario D/E loads (weights, volumes, handling pieces, heavy); `capacityClassFor` (5.5 ft box → suv, dump truck → pickup); `canCarry`; `audienceFor` with and without a site max |
| `pricing.test.ts` | V1–V9 exactly; free delivery at 50 000 but not 49 999; welcome at 25 000 but not 24 999; welcome vs promo best-of (`not_better`, `applied`); `invalid`, `expired`, `min_not_met`, `first_order_only`, `used_up`; labourer only for delivery, not for car, forced when unattended + heavy; pickup has no fees; every error code; quote overrides and custom lines; replacement source; letters and allocation order; **property test**: 1 000 random carts → Σ stores = order totals, every amount ≥ 0 |
| `settlement.test.ts` | `settleStoreOrder` (V4; all-zero → void; `current ≤ placed`); `refundForLines` (V5; caps; fees on whole-store-order refunds) |
| `driver-pay.test.ts` | offer examples (4 200, 4 775, 3 825, 4 950, 3 200, 4 550, 6 350, 7 850, 1 450), minimum $10, wait pay at 0/15/16/30/80 min, cancellation pay, failure pay by reason |
| `time-zone.test.ts` | §4.1 vectors (both 2026 and 2027 switches, gap, overlap), `toLocal` near UTC midnight, display helpers |
| `fulfilment-time.test.ts` | §4.8 vectors (ASAP, after cut-off, Fri/Sat/Sun slots, multi-store intersection, lead time, horizon, holidays, closures), pickup ready/hold, `respondBy` when closed, `offerOpensAt`, `resolveWindow` round-trip |
| `machines.test.ts` | full store-order table per actor and fulfilment; `orderStatusFromStoreOrders` for every combination of 1–3 store orders; `orderHeadline` precedence; delivery diff (`accepted → in_transit` refused with `requiresPickup`, release allowed, system transitions); `primaryDriverAction`; quote and issue tables |
| `validation.test.ts` | NANP (`4165550101`, `1-416-555-0101`, `+1 (647) 555-0199` valid; `0165550101`, `+442079460958` rejected); postal codes (`m5v2t6` → `M5V 2T6`; D F I O Q U rejected; non-Ontario first letters rejected); jobsite, product, store profile, vehicle, material list, issue validators |
| `catalog.test.ts` | `buildSearchTerms` ("2x4x8" → 2x, 2x4, 2x4x8; "1/2"; "10M"; plural stripping), synonyms (sheetrock → drywall, romex → nmd90, mud → joint compound); `CATEGORY_IDS` matches the rules list |
| `route-optimizer.test.ts` (extended) | `after` precedence: on random instances a pickup stop always precedes its drop-off after 2-opt and relocate; `lockedFirstId` stays first; existing cases unchanged |
| `market.test.ts` | `nearestCity` with anchors: the Grainline, Bluestone and Kestrel pins → toronto; the Copperline, Aircrest and Voltway pins → vaughan, markham, mississauga; `SERVICE_AREA` edges |

### 13.2 Rules tests (`firebase/tests/*.rules.test.ts`; F)

Per collection in §6.2, an allow and a deny case for: anonymous, customer A and B, supplier owner and
staff of store X, supplier of store Y, driver in the city and class of an offer, driver in another
city, car driver vs a pickup offer, pending driver, dispatcher, admin. Must include: supplier writes
only allowed product fields of its own store (never `reserved`, `listed`, `featured`, `familyKey`,
`storeId`, `sku`, `imageUrl`, unknown keys, or an `imagePath` outside `productPhotos/{storeId}/`);
jobsites reject a client-set `lastUsedAt` or `createdAt`; store documents are not client-writable;
store-order list requires the `storeId` filter; customers `get` only their own store orders; drivers never read store orders; private documents are
staff-only (owner reads store settings); job offers only when open and in the audience; a fixture
proves job offers contain no customer name, phone or exact address; jobsite validation (postal,
NANP, province, service area, pin-only new build); cards reject number/CVV fields and `rupay`; review
requires an own completed store order; support `senderRole` spoofing denied; quote/issue limited
staff updates; ledger and payouts per payee (store staff denied); store suggestions not
client-creatable. Storage: proof photos readable by the delivery's customer, quote uploads by type,
size and customer role, issue photos (customer role, owner metadata, store member read), store and
product photos by role.

### 13.3 Integration workflows (emulators, run-scoped data)

| File (owner) | Covers |
| --- | --- |
| `checkout-workflow.test.ts` (B) | multi-store placement equals `priceCheckout`; `PRICE_CHANGED`, `WINDOW_UNAVAILABLE`, `OUT_OF_RANGE`, `OUT_OF_STOCK`; same `checkoutId` twice → one order, one reservation, one authorization (also when the two calls run concurrently: the loser writes nothing and never voids the winner's authorization); decline card ••0002 writes nothing; **two concurrent first orders** → only one gets the welcome (the other `PRICE_CHANGED`); whole and partial cancel; capture once at settlement, clamped; capture failure ••0341 → staff alert → sweep retry; deadline capture then auto-refund |
| `store-order-workflow.test.ts` (C) | accept with shortage (V4: current, reserved, stock clamp, customer message); store A supplier denied on store B everywhere; reject cascade (delivery cancelled, offer deleted, stock released); ready gating; PIN wrong ×5 → `CODE_LOCKED`, staff override; customer pickup; hold expiry via `runJobNow`; escalation reminder → auto-reject; `onProductWritten` derived fields (no loop); `onStoreWritten` fan-out; store rating aggregate |
| `delivery-workflow.test.ts` (D) | manual deliveries still work without COD; tracking, routes, hand-off code |
| `job-board-workflow.test.ts` (D) | offer scheduled → open via `runJobNow`; two concurrent claims → exactly one wins (`OFFER_TAKEN`); class, city and 4-job limits; pending vehicle downgrade refuses bigger jobs; release reopens, clears the PIN (the old PIN fails at the counter) and `RELEASED_RECENTLY`; suspension releases uncollected jobs; driver cannot mark `picked_up`; store hand-over moves both documents; route plans put each pickup before its drop-off; photo required; tracking phases; route stops with `kind`; failure → resolve (reattempt and return); ledger entries created once on retried triggers |
| `quotes-issues-workflow.test.ts` (E) | submit (attachment checks) → send → accept at quoted prices with a custom line; version and expiry errors; reopen; issue window; refund after capture (V5) and credit before capture; clawback per fault; replacement order |
| `payouts-support-workflow.test.ts` (E) | daily run nets entries, carries negatives, skips held entries, idempotent rerun, a rerun finishes a run interrupted after creating a payout (no entry paid twice); support messages update summaries and notify customers and every store member; suggestion rate limit |

### 13.4 CI and demo

- CI `integration` job: `node scripts/emulators.mjs --exec "tsx --test firebase/tests/*.test.ts && tsx scripts/seed.ts"`
  (the seed is the end-to-end smoke test), plus `npm run check:legacy` in the quality job.
- **Manual demo (day 5):** browse as a guest, sign up as a new customer, add a jobsite by pin,
  multi-store checkout → portal accept, short-ship, mark ready → driver claims, checks in, store enters
  the PIN → simulator drives → live tracking → drop-off photo → report an issue → ops refunds →
  payouts → material list → quote builder with a special-order line → accept the quote.

---

## 14. Work breakdown

### 14.1 Workstreams (each file has exactly one owner)

| Key | Workstream | Owns (exclusive) | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| **A** | Shared domain | `packages/shared/**`, `packages/expo-firebase/**` | — | Contracts merged by **day 1, 12:00** (all §1.3 types, `api.ts`, `COLLECTIONS`, `CALLABLES`, `ERROR_CODES`, notification types, function signatures with stubs). Logic + every §13.1 test green by day 2 EOD; V1–V9 and the DST vectors exact; property test green; `optimizeStops` precedence (§5.11) and `nearestCity` anchors tested; no `Intl` in money/time; no runtime dependencies; `commerce.ts` gone. |
| **B** | Commerce & payments backend | `firebase/functions/src/index.ts`, `src/config/**`, `src/lib/**`, `src/modules/commerce/**`, `src/modules/payments/**`, `src/modules/auth/phone-otp.ts`, `firebase/functions/{package.json, build.mjs, tsconfig.json, .env.example, .env.instasupply-staging, .env.instasupply-prod}`, `firebase/tests/checkout-workflow.test.ts`, `firebase/tests/support/workflow.ts`; deletes `firebase/tests/commerce-workflow.test.ts` | A | Guards, ids, rate limits and every module barrel exported by day 1; `checkout-workflow` green; idempotent, atomic `placeOrder` (≤ 134 writes); capture once and clamped; refunds capped; aggregate idempotent; first-order race safe. |
| **C** | Stores & supplier backend | `src/modules/stores/**`, `src/modules/auth/staff.ts`, `src/modules/auth/supplier-users.ts`, `firebase/tests/store-order-workflow.test.ts` | A, B | `store-order-workflow` green; transitions only through the shared table; stock invariants (`reserved ≥ 0`, Σ open fulfilled = reserved, commit once); PIN lockout; cross-store denial everywhere; product trigger loop-free. |
| **D** | Deliveries, jobs & drivers backend | `src/modules/{deliveries, jobs, routing, tracking, geocoding, sms, maintenance}/**`, `src/modules/auth/{register-driver, driver-status, driver-vehicle}.ts`, `firebase/tests/delivery-workflow.test.ts`, `firebase/tests/job-board-workflow.test.ts` | A, B | `job-board-workflow` (incl. the claim race) and updated `delivery-workflow` green; offers PII-free and city/class-gated; pickup stops in route plans; tracking phases; vehicle review gates claims; `runJobNow` runs every job; no COD left in functions. |
| **E** | Quotes, issues, support, payouts & notifications | `src/modules/{quotes, issues, support, suggestions, payouts, notifications, chat}/**`, `firebase/tests/quotes-issues-workflow.test.ts`, `firebase/tests/payouts-support-workflow.test.ts`, `firebase/tests/device-tokens.test.ts` (existing, kept green) | A, B | Both workflows green; quote → order at locked prices incl. custom lines; refund/credit + clawback per fault; ledger idempotent; payouts idempotent and never before capture; support threads for customers and stores; new channels and preferences. |
| **F** | Security rules & indexes | `firebase/firestore.rules`, `firebase/firestore.indexes.json`, `firebase/storage.rules`, `firebase/tests/firestore.rules.test.ts`, `firebase/tests/marketplace.rules.test.ts`, `firebase/tests/storage.rules.test.ts`, `firebase/tests/support/rules.ts`, `firebase/tests/tsconfig.json`; deletes `firebase/tests/commerce.rules.test.ts` | A | Every §13.2 case green; index list matches §6.5 and every app/function query (no missing-index errors in the workflows); staging deploy dry-run accepts rules and indexes. |
| **G** | Customer app: shell, discovery, cart | `apps/customer/src/app/{_layout.tsx, (intro)/**, (auth)/**, (setup)/**}`, `apps/customer/src/app/(shop)/{_layout.tsx, (tabs)/_layout.tsx, (tabs)/index.tsx, (tabs)/stores.tsx, (tabs)/favorites.tsx (delete), site.tsx, search.tsx, categories.tsx, category/**, store/**, product/**, cart.tsx, saved.tsx}`, `apps/customer/src/features/{session, site, stores, catalog, cart, product, favorites, reviews}/**`, `apps/customer/src/{components, theme, types}/**`, `apps/customer/src/lib/{firebase, env, links, notify}.ts`, `apps/customer/{app.config.ts, package.json, tsconfig.json, metro.config.js, eas.json, CONVENTIONS.md, AGENTS.md, .env.example, .env.development, assets/**}` | A, F, K (seed v0) | Guest browsing; stores list + map; cross-store search with family grouping; store and product pages; cart grouped by store with load chips, meters and a `priceCheckout` preview identical to the server; site switcher; `RequireAccount` and hooks for H by day 2; Expo export (iOS, Android, web) passes; no grocery copy. |
| **H** | Customer app: checkout, orders, service, account | `apps/customer/src/app/(shop)/{checkout/**, order-success.tsx, (tabs)/orders.tsx, (tabs)/account.tsx, orders/**, quotes/**, issues/**, support.tsx, jobsites/**, cards/**, notifications.tsx, settings.tsx, about.tsx, help.tsx, suggest-store.tsx, addresses/** (delete)}`, `apps/customer/src/features/{checkout, orders, quotes, issues, support, jobsites, cards, account, notifications, addresses (delete)}/**`, `apps/customer/src/lib/callables.ts` | A, G, B, C, D, E | Place, track (per store, live), cancel, reorder and reorder & checkout, pickup PIN, drop-off photo, report an issue with photos, rate a store, material list + accept a quote, support chat, jobsites with pin, test cards; every §5.9 code recovers without losing the cart. |
| **I1** | Supplier portal | `apps/backoffice/src/portal/**`, `apps/backoffice/src/features/{auth, catalog, store-profile}/**` | A, C, F | Suppliers sign in to `/portal` and only ever see their store; new-order alert within 2 s; accept/short/ready/collect with PIN; catalogue edits obey rules; hours editor; payouts, insights, team, support; staff features unaffected. |
| **I2** | Ops console | `apps/backoffice/src/{app, components, lib}/**`, `apps/backoffice/src/{main.tsx, index.css, vite-env.d.ts}`, `apps/backoffice/src/features/{dashboard, live-map, deliveries, drivers, messages, notifications, team, tracking, outbox, orders, stores, jobs, quotes, issues, support, payouts, suggestions}/**`, `apps/backoffice/{index.html, vite.config.ts, package.json, tsconfig.json, .env.example, .env.development, public/**}` | A, B, C, D, E, I1 | `/portal/*` mounted and supplier redirect on day 1; ops runs the whole demo script without the Firebase console: store wizard, marketplace orders with payment events, quote builder with live totals and custom lines, issues with the refund calculator, support inbox, job board with assign and labourer booking, driver vehicle review, payouts, tracking page phases. |
| **J** | Driver app | `apps/driver/**` | A, D | Onboarding with city, vehicle and attestations; board filtered by audience; claim (race message); store check-in, PIN card, live hand-over; photo-proof completion; release; earnings; vehicle draft + review banner; route pickup stops; Expo exports pass; no COD. |
| **K** | Seed, scripts, art, docs, CI | `scripts/**`, `packages/art/**`, `docs/**`, `README.md`, `infra/**`, `.github/**`, `firebase.json`, `.firebaserc`, `package.json` (root), `eslint.config.mjs`, `.prettierignore` | A (seed v0); B–E (seed v1) | Seed v0 (accounts, categories, stores, products, jobsites via Admin SDK) on day 2; seed v1 (every §11.5 scenario through callables, any time of day) on day 4; simulator pickup leg; art complete and `generated.ts` rebuilt; docs rewritten; region set in `deploy.yml` variables and the bootstrap per D13; CI runs the seed and the legacy grep. |

### 14.2 Order of work

| Day | Work |
| --- | --- |
| 1 | **A** freezes contracts by 12:00 (stubs compile). **B** wires `index.ts`, lib helpers and empty barrels; every backend WS publishes its §5.2 helper stubs by 15:00. **I2** mounts `/portal/*`; **G** creates the tab layout, `RequireAccount` and placeholder files for H's tabs (handed over at once). **F** drafts rules. **K** starts data files and art. |
| 2 | **A** logic + tests (critical path). **B** `placeOrder`, payments, aggregate; **C** store-order callables and triggers; **D** delivery staging, offers, `claimJob`, hand-over coupling; **E** quotes, issues, support. **F** rules + fixtures. **K** seed v0. Apps build screens on seed v0. |
| 3 | Integration: checkout → portal → board → driver → tracking; workflow tests; apps on live callables. |
| 4 | Quotes, issues, refunds, payouts end to end; seed v1; migration deletions and legacy grep; docs. |
| 5 | Lint, typecheck, unit, rules and integration tests, Expo exports, staging deploy, demo script, bug bash. P1 only once green. |

### 14.3 Day-1 scaffolding protocol

B creates `src/modules/<m>/index.ts` (exporting `{}`) for every module and the root re-exports;
I2 creates the `/portal/*` route line and an empty `portal/PortalApp.tsx`; G creates empty route
files for H's tab (`(tabs)/orders.tsx`, `(tabs)/account.tsx`). Each placeholder is handed to its owner
immediately and never edited by its creator again. Contract changes after the freeze go through A in
small PRs (A stays on call all week). New dependencies are added on day 1 by the owner of the
`package.json` on request: customer app (G) `expo-image-picker`, `expo-document-picker`,
`expo-crypto`; driver app (J) none beyond today's; back office (I2) none; functions (B) none.

### 14.4 Staffing

About 10 engineers and 1 illustrator: A, B, C, D, E, F, G, H, I1+I2 (two engineers), J; the illustrator
works under K, with K's scripts and docs owned by the engineer who finishes first (F after day 2 is the
default). With fewer people merge F into A after day 2, I1 into I2, and K's seed into E.

### 14.5 Definition of done (all workstreams)

`npm run lint && npm run format:check && npm run typecheck && npm test` green; workflow tests green;
Expo exports pass; loading, empty and error states on every screen; no hard-coded colours outside
tokens; accessibility roles and labels; the legacy grep passes.

### 14.6 P1 (stretch) and cut order

**P1:** `boostJobPayout`; live `etaToStoreAt` refresh; `carts/{uid}` sync; portal CSV import/export;
insights charts; supplier responses on issues (P0 uses the store support thread); job reminders to the
claimed driver; store pins on the live map; reverse geocoding; manual ledger adjustments; later-pickup
scheduling; store `readyInMinutes` estimate at acceptance; web push (FCM) for the supplier portal (P0:
open portal + SMS). **If the week runs short, cut in this order:** P1 items → store reviews →
insights → suggestions UI (keep the callable) → store support threads. **Never cut:** checkout, the store-order machine, the job board and PIN hand-over, tracking,
quotes, issues with refunds, rules, seed.

---

## 15. Open questions and out of scope

**Open questions** (decisions above are defaults until answered):

1. Merchant of record and HST treatment (InstaSupply charges HST on the full sale; suppliers are paid
   item value minus commission): needs an accountant before production, including whether HST
   applies to the commission or to the supplier's sale to InstaSupply (payouts carry no HST today)
   and whose registration number receipts show (`hstNumber`, InstaSupply's by default).
2. Commission rates (900–1 200 bps placeholders) and supplier agreements.
3. Free delivery at $500 across several stores and large vehicles costs margin (V3 waives $128.62 of
   list fees): monitor; a large-vehicle surcharge may be needed.
4. Does a pickup first order consume the "$0 delivery on your first order" perk? (Default: yes, the
   first order of any kind.)
5. "Over $500/$250": implemented as "at least"; confirm.
6. Labourer workforce: who supplies them, booking SLA and per-class prices (placeholders). The driver
   site says InstaSupply "sends an unloader" when the site is empty and the load heavy; v1 charges
   the customer the labourer fee in that case (mandatory add-on, D5). Confirm, or absorb the cost.
7. Driver terms, liability wording and insurance checks need legal review; payouts need Stripe
   Connect onboarding.
8. Stores on statutory holidays: v1 closes all fulfilment on `ONTARIO_HOLIDAYS`.
9. Production support phone, HST registration number and Twilio sender numbers (the site's
   material-list page gives (647) 952-9448, WhatsApp and support@instasupply.ca; confirm they are the
   production contacts).
10. All fictional seed names must be checked against real businesses before public demos.
11. Product documents are public, so exact `stockOnHand` and `reserved` let anyone watch a store's
    sales. Keep them (live stock is a site promise), or publish only an availability band?
12. The website accepts a material list without an account; the app requires sign-in because a quote
    is accepted and paid in the app. Should the app take guest lists with contact details?
13. Retention (PIPEDA) of drop-off photos, issue photos and quote uploads: proposed 24 months, then a
    Storage lifecycle rule deletes them.

**Out of scope:** live Stripe payments and Connect payouts; POS/inventory sync (Shopify, QuickBooks,
Zoho, Odoo, Epicor, Excel, Lightspeed, Square); store self-delivery; multi-pickup routes; master
catalogue and SKU matching; hosted full-text search; multi-location supplier accounts; company
accounts with several buyers and net-30 terms; substitutions; return pickups; WhatsApp and email
sending; a public web storefront and web material-list form; French localization; driver document
uploads; a labourer app; tips and surge pricing; delivery and pickup mixed in one order; PDF invoices
and statements (the receipt screen only); cities outside the 15 GTA cities (a `CityId` and rules change).
