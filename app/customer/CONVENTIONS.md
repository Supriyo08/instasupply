# Customer app conventions (handover for screen builders)

The InstaSupply customer app: construction supplies from local GTA stores, delivered to the jobsite
or ready for pickup. Expo SDK 58, React Native 0.88, Expo Router. It keeps the "Big Cart" design
language (lime gradient buttons, Poppins, white cards on `#F4F5F9`, pastel circles behind artwork,
floating gradient cart button). Firebase is gone: every read and write goes through
`@instasupply/api-client` to the Fastify API (docs/PLATFORM.md, docs/CLIENTS.md).

Specs to keep open: MARKETPLACE §7 (screens, copy), CLIENTS §4.3 (what each screen reads and
calls), CLIENTS §2.2 (session), §6 (push), §7 (maps), MARKETPLACE §5.9 (error codes).

## Running it

```bash
npm run dev:backend          # from the repo root: API on :4000 (local PostgreSQL 17)
npm run dev:customer:web     # or dev:customer for a phone / emulator (Metro on :8082)
```

`EXPO_PUBLIC_API_URL` is empty in `.env.development`: the app finds the API on the machine running
`expo start` (the page's host on web, the LAN address on a phone, `10.0.2.2` on the Android
emulator) at port `EXPO_PUBLIC_API_PORT` (4000). `.env.production` holds the production origin;
`app.config.ts` refuses a release bundle without an `https://` origin. Support phone, HST number,
map tiles, payments mode and phone-verification mode come from `GET /config` (`useConfig()`),
never from env.

## Layout

```
src/app/                      routes only (thin screens)
  _layout.tsx                 ApiProvider → SessionProvider → SiteProvider → CartProvider → ToastProvider, guards
  (intro)/intro               status "onboarding"
  (auth)/welcome|login|signup|forgot-password      status "guest" (pushed over the shop with ?next=)
  (setup)/complete-profile|verify-phone|verify-code|wrong-account
  (shop)/_layout.tsx          FavoritesProvider(uid|null), NotificationsBridge only when signed in
  (shop)/(tabs)/index|stores|orders|account        Home · Stores · Orders · Account + cart button
  (shop)/…                    every route of MARKETPLACE §7.3 (see "Route status" below)
src/features/<feature>/       data hooks, providers, feature components
src/components/ui/            design system (import from '@/components/ui')
src/components/map/           AppMap (the only map), LeafletCanvas ('use dom'), map types/icons
src/components/dev/RoutePlaceholder.tsx          stand-in for unbuilt routes
src/lib/                      api.ts (the client), env.ts, callables.ts, ids.ts, notify.ts, links.ts
src/hooks/useNow.ts           server-corrected clock that ticks
src/theme/tokens.ts           colours, gradient, fonts, typography, spacing, radius, shadows, statusTones
```

## Session and guards (CLIENTS §2.2)

`useSession()` → `{ status, user, profile, signingUp, problem, retry, finishOnboarding, endReason,
acknowledgeEnd, phoneVerification }`. Status is derived from the api-client session core, `/config`
and the intro flag:

`loading` → `onboarding` (intro not seen) → `guest` (no account) → `needs_profile` →
`wrong_account` (role is not customer) → `needs_phone` (only when `phoneVerification === 'required'`;
`effectivePhoneVerification` turns it 'off' on a production server whose SMS goes to the outbox) →
`ready`.

- Guards live in `src/app/_layout.tsx`. `(shop)` is open to `guest` **and** `ready`. Screens never
  redirect for auth themselves.
- **🔒 screens** wrap their body in `<RequireAccount title="…">` (`features/session/RequireAccount`).
  Guests see "Sign in to order" with Sign in / Create account; inside it `useCustomer()` is safe.
- `useUid()` is the uid or null; use it on screens guests can open and pass it to hooks (every
  signed-in descriptor is disabled for null, without a request).
- Send a guest to sign in with `goToSignIn(pathname)` → `/login?next=…`; login returns with
  `router.dismissTo(next)` after success.
- `homeHref('guest')` is `/welcome` (where the intro lands). A guest's cold start opens Home.
- Session endings are announced by `SessionEndNotice` (toast for expired/revoked, alert for
  suspended). `problem` (no network on first start, unloadable account) is shown by the root layout
  with "Try again"; it recovers by itself once the server answers.
- Auth flows: `features/session/auth-service.ts` — `signIn`, `createAccount({ name, email,
  password, companyName, accountType, marketingOptIn, phone })` (keeps "loading" while
  `registerCustomer` runs), `completeProfile({ displayName, … })`, `requestPhoneCode`,
  `verifyPhoneCode`, `requestPasswordReset` + `resetPassword` (two-step forgot password is done),
  `changePassword`, `signOut`. Sign-out in screens: `useSignOut()` (confirm, sign out, empty cart).
- Phone: `+1` chip, NANP only (`features/session/components/phone.ts`, `parsePhoneInput`).
- Profile writes: `features/account/profile-service.ts` (`updateDisplayName`, `updatePreferences`,
  `updateProfile`). `profile.stats` replaces order counting.

## Data (all from `@instasupply/api-client`)

Every hook returns the api-client `QueryResult` `{ data, loading, error, retry, refreshing,
updatedAt }` (paged hooks: `{ items, loading, loadingMore, hasMore, loadMore, error, retry }`).
`loading` is true from the render in which the key changes; lists keep previous data meanwhile.
Give `retry` to `ErrorState`. Never put a URL path or topic string in a screen.

| Feature | Exports |
| --- | --- |
| `features/catalog/hooks` | `useCategories`, `useCategory(id)`, `useCategoryTint(id)`, `useProduct(id)`, `useProductsByIds(ids)`, `useProductSearch(params)`, `useFeaturedProducts(n)`, `useFamilyOffers(familyKey)`, `useBuyAgain(uid)`, type `ProductSearchParams` |
| `features/stores/hooks` | `useStores()` (closed hidden), `useStore(id)`, `useStoreProducts(id, { categoryId, q })` (paged), `useStoreReviews(id)` (paged), `useMyStoreReview(storeId, storeOrderId)`, `storeView(store, site, now, vehicleClass)`, `useStoreViews()` → `{ views, byId, now }` with distance and `storeAvailability()` (badge, promise, deliverBy, pickupReadyAt) |
| `features/site` | `SiteProvider`/`useSite()` → `{ site, ready, chooseJobsite, choosePoint, clear }` (`site`: label, location, addressLine, receiving, maxVehicleClass, jobsite; stored under `instasupply.site.v1`); `hooks.ts`: `useJobsites(uid)` (+ `defaultJobsite`), `saveJobsite`, `deleteJobsite`, `setDefaultJobsite`, `jobsiteFields`; `location.ts`: `locateMe()` |
| `features/cart` | `useCart()` v2 (`instasupply.cart.v2`): `lines {productId, storeId, quantity}`, `ready`, `count`, `storeIds`, `add(product, n)` / `setQuantity(product, n)` → `CartChange` (refuses a 6th store "One order can include up to 5 stores" or a 101st line), `remove`, `removeStore`, `replace` (Reorder), `clear`, `promoCode`, `unloadHelpStoreIds`/`setUnloadHelp`, `fulfilment`/`setFulfilment`. `useCartPricing()` → `{ groups (per store: store, view, lines, priced, warnings), pricing: PricedCheckout, warnings, input, canCheckout, loading, error, retry }` via shared `priceCheckout` |
| `features/favorites` | `FavoritesProvider` / `useFavorites()` → `{ ids, ready, error, retry, isFavorite, toggle }` (optimistic; rejects for guests) |
| `features/orders/hooks` | `useCustomerOrders(uid, 'active'\|'past', { jobsiteId })` (paged), `useOrder`, `useOrderStoreOrders`, `useStoreOrder`, `useStoreOrderProof`, `useTracking(token)`, `useIsFirstOrder()`, `placeOrder`, `cancelOrder` |
| `features/quotes/hooks` | `useCustomerQuotes(uid)` (paged), `useQuote`, `submitMaterialList`, `acceptQuote`, `closeQuote`, `reopenQuote` |
| `features/issues/hooks` | `useCustomerIssues(uid)` (paged), `useIssue`, `reportIssue` |
| `features/support/hooks` | `useSupportThread(uid)` → `{ thread, messages }`; `useSupportActions(uid)` → `{ send, markRead }` (optimistic append) |
| `features/cards/hooks` | `useCards(uid)` (+ `defaultCard`), `validateCard(input, now)`, `addCard(input, existing)`, `setDefaultCard(card)`, `deleteCard(id)`; the server moves the default flag |
| `features/notifications/hooks` | `useNotifications(uid)` (+ `unread`), `useNotificationActions(uid)` → `{ markRead, markAllRead }` (optimistic), `notificationHref(data)` (CLIENTS §6.4), `notificationData(item)` |
| `features/uploads/pick.ts` | `pickPhotos({ camera?, max })`, `pickDocuments({ max })` → `UploadSource[]` (native photos compressed); then `validateUpload` and `api.upload({ purpose, ownerId, source })` |
| `@instasupply/api-client/react` | `useConfig()`, `useFileUrl(path)`, `useLiveStatus()`, `useApi()`, `useApiMutation` |

Rules that matter:

- **Request ids**: `newRequestId()` from `@/lib/ids` for `checkoutId`, `requestId`, `issueId`,
  message ids. Create once per attempt (`useState(() => newRequestId())`) and keep it across
  retries; a retry after a lost answer then returns the same order.
- **Errors**: `describeError(e)` words any error; for commands map `errorCodeOf(e)` and
  `detailsFor(e, 'PRICE_CHANGED')` etc. (MARKETPLACE §5.9, CLIENTS §4.3 checkout row).
  `isNetworkError` means "keep what was typed".
- **Money and time**: amounts are cents; format with `formatMoney`/`formatFee` from shared. Times
  are epoch ms; use `useNow()` (server-corrected) for promises and countdowns, and shared
  `formatClockET`, `formatDayET`, `windowLabel`, `storeAvailability`, `asapWindow`, `scheduledWindows`.
- Prices shown always come from `priceCheckout` / product data; the server prices again.
- Commands: `call(name, request)` from `@/lib/callables` (typed); REST writes `api.<resource>.*`
  from `@/lib/api`.

## Maps (CLIENTS §7)

Import only `AppMap` from `@/components/map`. Props: `markers` (`store`, `site`, `driver`, `stop`,
`pin`), `polylines`, `circles`, `fit` (`{ key: fitKeyFor(points), points }`: the camera refits only
when `key` changes), `interactive`, `pick` + `onPick` (draggable pin; round with `r6`, check
`isInServiceArea`), `onMarkerPress`, `style` (give it a height), `accessibilityLabel` (required).
One map per screen. Tiles come from `/config`; skeleton, offline note and the "Open in Maps"
fallback are built in. `LeafletCanvas.tsx` is an Expo DOM component (`'use dom'`,
react-native-webview on native) and is the only file that imports Leaflet. No screen renders
`AppMap` yet: the first one that does must be checked on Android and web.

## Push (CLIENTS §6)

`NotificationsBridge` (mounted only while signed in) registers silently when permission was granted,
opens tapped notifications (wrong-account guard, de-duplicated), and raises the in-app banner for new
inbox items. Never prompt at start: the order-success card ("Get delivery updates") and Settings call
`usePushPermission().enable()` (`features/account/usePushPermission`), whose `status` is
`unsupported` on web, in Expo Go and in builds without push credentials; show "Push alerts aren't
set up in this build. Updates appear in your inbox." then. Channels: `orders`, `chat`, `updates`,
`promotions`.

## Building blocks (UI kit, `@/components/ui`)

`Screen` (header/footer slots, scroll, pull-to-refresh), `Header` (back arrow, centred title, right
slot as wide as its content), `Text` (variants display … micro; colours default, muted, subtle,
primary, primaryDark, danger, white, warning), `Button` (primary gradient, secondary, ghost, danger),
`Input` (`tone="muted"` on white, `ref`, `multiline`, `hint`, `error`), `IconButton`, `Card`,
`Badge` (new, sale, brand, info, neutral, **success, warning, danger**), `QuantityStepper`
(`label`), `Rating`, `EmptyState`, `ErrorState`, `Notice` (the only inline banner), `Sheet`,
`Toggle`, `Divider`, `Skeleton`, `ArtImage`, `Icon` (Feather) / `FilledIcon`.

New for the marketplace:

- `StatusPill` (`tone`: success, warning, danger, info, neutral from `statusTones`) for store-order,
  delivery, quote and issue statuses.
- `StockPill` ("1,200 in stock at Kestrel" / "Only 4 left" / "Out of stock") from `availableQty`.
- `PromiseLabel` for `storeAvailability().promise` (green for delivery/pickup, muted for "Opens …").
- `Chip` (selectable filter/choice pill: filters, "I'm a…", bulk +10/+25/+50, search examples).
- `SegmentedControl` ("Active · Past · Quotes", "Delivery | Pickup", "List ⇄ Map").
- Tokens: `productBackdrops` is gone; the pastel behind artwork is the category's `tint`
  (`useCategoryTint(categoryId)`, fallback `fallbackTint`). `statusTones` for pills.

Kit details that are easy to miss (carried over): `Text color="primaryDark"` for prices and promises
on white; `Notice` takes `message` (required) and an optional `title`; `ErrorState` for a failed
list or screen, a `danger` `Notice` with "Try again" inside forms; on web everything keeps to the
`CONTENT_MAX_WIDTH` (560) column (`webColumn` for custom bars); `shadows.overlay` has no Android
elevation.

**Artwork** (`ArtImage artKey`): products `product.imageKey` (fallback the category `iconKey`),
categories `cat-*`, stores `store-*`, scenes `scene-welcome`, `scene-jobsite-delivery`,
`scene-live-tracking`, `scene-local-suppliers`, `scene-material-list`, `scene-order-confirmed`,
`scene-pickup-ready`, `scene-report-issue`, `scene-support`, `scene-empty-cart`.

## Route status

Working (foundation): `_layout`, `(intro)/intro`, `(auth)/*` (welcome has "Browse first"; login
honours `?next=`; forgot-password is two-step), `(setup)/*` (+1 phone), `(shop)/_layout`,
`(tabs)/_layout`, `(tabs)/account` (foundation version: profile, the §7.3 menu, sign-out; guests get
the sign-in card). `signup` still lacks company, "I'm a…" chips and the "Send me deals" opt-in
(`createAccount` already accepts them).

Placeholders (`RoutePlaceholder`; replace the whole file): `(tabs)/index`, `(tabs)/stores`,
`(tabs)/orders`, `site`, `search`, `categories`, `category/[id]`, `store/[id]/index`,
`store/[id]/reviews`, `store/[id]/review`, `product/[id]/index`, `cart`, `saved`, `checkout/index`,
`checkout/window`, `checkout/jobsite`, `checkout/card`, `order-success`, `orders/[id]/index`,
`orders/[id]/track/[storeOrderId]`, `issues/new`, `issues/[id]`, `quotes/new`, `quotes/index`,
`quotes/[id]/index`, `quotes/[id]/accept`, `support`, `jobsites/index`, `jobsites/edit`,
`cards/index`, `cards/add`, `notifications`, `settings`, `help`, `about`, `suggest-store`. The
grocery-era version of a replaced screen is in git: `git show HEAD:app/customer/src/app/(shop)/<path>`.

Deleted (MARKETPLACE §12.4): `(tabs)/favorites`, `product/[id]/reviews`, `product/[id]/write-review`,
`checkout/address`, `checkout/payment`, `orders/index`, `addresses/*`, `features/addresses`,
`features/account/address`, `features/account/useOrderCount`, `features/catalog/reviews.ts`, the
product review components, `checkout/{PaymentMethodTiles, AddressOption, DeliveryAddressCard,
StepProgress}`, `orders/components/RateItemsCard`, `orders/components/TrackingMap*` (→ `AppMap`),
`features/cart/useCartDetails` (→ `useCartPricing`), `lib/firebase.ts`.

**Grocery-era components that do not type-check yet** (nothing imports them; port what is useful,
delete the rest): `components/catalog/*` (deleted),
`features/catalog/components/{HomeTopBar, SearchResults, filters, usePromoBanners}`,
`features/checkout/{CardOption, CartFooter, CartItemRow, FreeDeliveryProgress, OrderReceipt,
OrderSummaryCard, PaymentSection, PlaceOrderFooter, ProductThumb, PromoCodeSection}` (and
`usePlaceOrder`, `CartErrorNotice`, which describe the old cart), `features/orders/components/*`
(order-ui, OrderTimeline, OrderCard, LiveTracking, …), `features/product/*` (ProductInfo,
FavoriteRow, useProductPurchase, constants, …). `npx tsc --noEmit -p app/customer` reports errors
only in these files; everything else is clean.

## Rules

- TypeScript strict, no `any`. Small focused files (< ~250 lines); extract feature components.
- Colours, spacing, radius and type only from `@/theme/tokens` and `Text` variants: no stray hex.
- Every interactive element gets `accessibilityRole` / `accessibilityLabel`.
- iOS, Android **and web**: native-only APIs behind a `Platform` guard or a `.web.ts(x)` variant.
- Loading (`Skeleton`), empty (`EmptyState`) and error (`ErrorState` + `retry`) states; disable
  buttons while busy. Copy is Canadian English and trade wording (MARKETPLACE §7.1).
- Install Expo modules with `npx expo install` inside `app/customer`. Run
  `npx tsc --noEmit -p app/customer`, `npx eslint app/customer` (plus
  `npx eslint --no-ignore app/customer/src/lib`, which the root config skips) and
  `npx prettier --check app/customer` before handing back.
