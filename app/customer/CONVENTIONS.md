# Customer app conventions

The InstaSupply shopping app (Expo SDK 58, React Native 0.88, Expo Router). It follows the
"Big Cart" grocery design: fresh lime-green gradient brand, Poppins type, light-grey canvas
(`#F4F5F9`) with white cards, pastel category colours and custom vector illustrations.

## Layout

```
src/app/                 routes only (thin screens)
  (intro)/intro          onboarding slides           – session status "onboarding"
  (auth)/welcome|login|signup|forgot-password        – "signed_out"
  (setup)/complete-profile|verify-phone|verify-code|wrong-account
  (shop)/(tabs)/index|account|favorites              – bottom tabs + floating cart button
  (shop)/cart, categories, category/[id], search, product/[id]/(index|reviews|write-review),
         checkout/address, checkout/payment, order-success, orders/(index|[id]),
         addresses/(index|edit), cards/(index|add), notifications, settings, about
src/features/<feature>/  data hooks, providers and feature components
src/components/ui/       design system (import from '@/components/ui')
src/components/catalog/  ProductCard, ProductGrid, CategoryCircle, PriceSummary
src/lib/                 firebase client, typed callables, env, notify/confirm
src/theme/tokens.ts      colours, gradient, fonts, typography, spacing, radius, shadows
```

Route guards live in `src/app/_layout.tsx` (session status → group) — screens never redirect
for auth themselves. Navigate with `router.push('/product/abc')`, `router.replace('/')`, etc.

## Building blocks

**UI kit** (`@/components/ui`): `Screen` (header/footer slots, scroll, pull-to-refresh),
`Header` (back arrow + centred title + right slot), `Text` (variants: display, title, heading,
subheading, body, bodyMedium, caption, captionMedium, micro; colours: default, muted, subtle,
primary, primaryDark, danger, white, warning), `Button` (primary = brand gradient, secondary,
ghost, danger; `trailingIcon` for the bag on "Add to cart"), `Input` (white field with leading
Feather icon; `multiline` for a text area), `IconButton`, `Card`, `Badge` (new, sale, brand, info,
neutral), `QuantityStepper` (horizontal or `vertical`, `compact`), `Rating`, `EmptyState` (uses an
illustration), `ErrorState` (data failed to load: icon, message, "Try again"), `Notice` (inline
banner: info, success, warning, danger), `Sheet` (bottom sheet), `Toggle`, `Divider`, `Skeleton`,
`ArtImage` (renders an illustration by key, or a photo `uri`), `Icon` (Feather line icons — the
design's style) and `FilledIcon` (Ionicons).

Kit details that are easy to miss:
- **`Text color="primaryDark"`** is the green for text on white or on the grey canvas, such as
  prices. `primary` is too light to read there; keep it for icons, fills and short links.
- **`Input`**: `tone="muted"` fills the field grey so it shows on white surfaces (`Sheet`, cards).
  `ref` reaches the TextInput, to move focus to the next field. `multiline` makes it a text area
  (set the height with `style={{ minHeight }}`); use it for every multi-line field, so the font,
  focus border and error border match. `hint` and `error` go under the field. A caller's
  `accessibilityLabel` wins over the label or placeholder.
- **`Notice`** is the only inline banner: `tone` (`info`, `success`, `warning`, `danger`), an
  optional `title`, `icon` to replace the tone's own icon, and one short action (`actionLabel` +
  `onAction`, e.g. "Remove" or "Try again"). Use it for form errors, confirmations, stock warnings
  and hints.
- **`ErrorState`** is what a screen or list shows when its data failed to load:
  `<ErrorState title="Couldn't load your orders" error={error} onRetry={retry} />`. It words the
  error itself (`describeError`) and always offers "Try again". Inside a form or a checkout step,
  where the rest of the screen stays usable, show a `danger` `Notice` with a "Try again" action
  instead.
- **`Header`**: the right slot is as wide as its content, so it can hold a text action such as
  "Mark all read"; the title stays centred.
- **`Badge`** aligns itself to the start; pass `style` (e.g. `alignSelf: 'center'`) to change that.
- **`QuantityStepper`**: pass `label` (e.g. the product name) so screen readers say "Increase
  quantity of Fresh Lime" rather than the same words on every row.
- **Web column**: in a desktop browser everything keeps to one centred column, `CONTENT_MAX_WIDTH`
  (560) wide. `Screen` and `Header` do this themselves. A custom bar (top bar, tab bar) keeps its
  background on a full-width view and gives `webColumn` to the row inside it; `webColumn` is
  `null` on native. Something that floats over the page (the toast) caps its own width with
  `CONTENT_MAX_WIDTH`.
- **`shadows.overlay`** (`@/theme/tokens`) is the soft shadow without Android `elevation`. Use it
  on a layer that sits under its siblings, such as the backdrop of a floating header: `elevation`
  would lift that layer above the buttons drawn over it.

**Catalog components**: `ProductCard` (handles favourite + add-to-cart itself), `ProductGrid`,
`CategoryCircle`, `PriceSummary`.

**Data** (all realtime). The Firestore hooks below (catalog, addresses, cards, orders,
notifications) return `{ data, loading, error, retry }`. `loading` is true from the render in which
the query changes, and the previous `data` stays on screen until the new one arrives. A listener
that fails stops for good, so give `retry` to `ErrorState` (or to a `Notice` action).
- `useSession()` / `useCustomer()` → `{ user, profile }`; auth actions in `features/session/auth-service.ts`.
  `useSession()` also has `status`, `signingUp` (sign-up is still creating the profile, so `status`
  stays `loading`) and `problem` with `retry()` (the account could not be opened as a shopping
  account). The root layout shows `problem` with "Try again" and a sign-out link; screens never
  handle it.
- Catalog: `useCategories`, `useCategory(id)`, `useFeaturedProducts(n)`, `useCategoryProducts(id)`,
  `useProduct(id)`, `useProductSearch(text)`, `useProductsByIds(ids)`, `useReviews(productId)`,
  `useMyReview(productId, uid)`, `saveReview(...)`.
- Cart: `useCart()` (lines, count, quantityOf, add, setQuantity, remove, clear, promoCode,
  setPromoCode) and `useCartDetails(uid)` (items joined with live products + `priced` from
  `priceCart`, `canCheckout`, `isFirstOrder`, and `loading`, `error`, `retry` like the hooks above).
  With `error` set there are no items and nothing is known about the lines: show the error with
  `retry` (`ErrorState` on the cart, `CartErrorNotice` in a checkout step), never the lines as
  missing or a zero total.
- Favourites: `useFavorites()` → `{ ids, ready, isFavorite, toggle }`. `ready` is false until the
  list has loaded: show a skeleton until then, not the empty state.
- Addresses: `useAddresses(uid)` → `{ data, defaultAddress }`, `saveAddress`, `setDefaultAddress`,
  `deleteAddress`; validate forms with `validateAddressFields` from `@instasupply/shared`.
- Cards: `useCards(uid)`, `validateCard`, `addCard`, `setDefaultCard`, `deleteCard` (only brand,
  last 4 and expiry are stored; card payments run in **test mode**).
- Orders: `useOrders(uid)`, `useOrder(id)`, `useTracking(trackingToken)` (live driver position,
  ETA, hand-off code), `placeOrder(req)`, `cancelOrder(req)`, `useIsFirstOrder(uid)`.
- Notifications: `useNotifications(uid)`, `markRead`, `markAllRead`, `notificationHref`, `useToast()`.
- Helpers: `notify(title, msg)`, `confirmAction(title, msg, label)` in `@/lib/notify`;
  `describeError(error)` from `@instasupply/expo-firebase`; formatting (`formatCurrency`,
  `formatDate`, `formatRelativeTime`, …), statuses (`ORDER_STATUS_META`, `ORDER_PROGRESS`,
  `canCustomerCancel`) and pricing from `@instasupply/shared`.

**Illustrations** (`ArtImage artKey="…"`): products use `product.imageKey`; categories use
`category.iconKey`; scenes: `hero-basket`, `hero-fruits`, `hero-discount`, `hero-welcome`,
`hero-promo`, `hero-empty-cart`, `hero-order-success`, `hero-delivery`, `brand-mark`.

## Rules

- TypeScript strict, no `any`. Small focused files (< ~250 lines); extract feature components.
- Colours, spacing, radius and type only from `@/theme/tokens` and `Text` variants — no stray hex.
- Every interactive element gets an `accessibilityRole`/`accessibilityLabel`.
- Must work on iOS, Android **and web**: no native-only API without a `Platform` guard; for
  libraries that only work or only matter on a phone (react-native-maps, expo-notifications)
  provide a `.web.tsx` / `.web.ts` variant, which also keeps them out of the web bundle.
- Show loading (`Skeleton`), empty (`EmptyState`) and error (`ErrorState` with the hook's `retry`)
  states; an error is never a dead end. Disable buttons while busy.
- Prices shown to the user always come from `priceCart`/catalogue data; the server re-prices.
