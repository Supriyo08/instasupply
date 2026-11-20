# Console conventions (handover for screen builders)

The console (`frontend/`) is the ops back office, the supplier portal at `/portal` and the public
tracking page `/track/:token`. Firebase is gone: every byte of data goes through
`@instasupply/api-client` (docs/CLIENTS.md §1). This file says where things live and the rules every
screen follows. The specs win over this file: MARKETPLACE §8 (portal), §9 (ops), §7 (tracking page);
CLIENTS §2.7, §4.4, §4.5, §6.4, §7.5; PLATFORM §5.5 (console rows), §6.3.8.

## 1. Run it

```sh
npm run dev:backend                        # API on :4000 (PostgreSQL 17, current OS user)
npm run dev:frontend                       # console on :5173, calls http://<page host>:4000
npm --workspace @instasupply/frontend run typecheck
npx eslint frontend && npx prettier --check frontend
VITE_API_URL=http://localhost:4000 npm run build:frontend   # vite refuses to build without VITE_API_URL
```

Demo data comes from `npm --workspace @instasupply/backend run seed` (`seed --demo`, MARKETPLACE §11): `admin@instasupply.test`,
`dispatch@instasupply.test`, supplier owner `kestrel@instasupply.test`, staff
`kestrel.staff@instasupply.test`, password `SEED_PASSWORD` (development default `Instasupply@123`).

## 2. Where things live

| Path | What |
| --- | --- |
| `src/lib/api.ts` | the one `api` client, `call`, `queries`, `topics`, `describeError` (= `errorMessage`), `detailsFor`, `errorCodeOf`, `isNetworkError`, `ApiError`, `WithId`. Import from here, not from `@instasupply/api-client` (types and the React hooks of `@instasupply/api-client/react` are fine to import directly). |
| `src/lib/env.ts` | `env.apiUrl` (`VITE_API_URL`, default `http://<page host>:4000` in dev), `env.dev`. Nothing else is configured at build time: map tiles, SMS mode, `allowTestJobs`, tracking base URL come from `useConfig()` (`GET /config`). |
| `src/lib/data.ts` | shared live hooks: `useDrivers`, `useStaff`, `useDriverLocations`, `useOpenDeliveries`, `useClosedToday`, `useRecentDeliveries`, `useRoute` (guards half-written plans), `useThreads`, `useActivity`, `useOpenStoreOrders(filters)`, `useFailedStoreOrders`, `useOpsDashboard`; helpers `useNow`, `useStartOfToday` (Toronto), `presenceOf`, `indexById`, `groupActiveByDriver`, `mergeById`; types `CollectionState`, `DocumentState`, `UserRecord`/`DriverRecord`, `DeliveryRecord`, `StoreOrderRecord`. |
| `src/features/*/hooks.ts` | per-feature data: `deliveries/hooks` (`useDelivery`, `useDeliveryEvents`, `usePrivateMeta`, `useTrackingUrl`), `drivers/hooks`, `messages/hooks` (`sendStaffMessage`, `markThreadRead`), `orders/hooks` (`useOpsOrders`, `useOpsStoreOrders`, `useOrder`, `useOrderStoreOrders`, `useStoreOrder`, `useStoreOrderPrivate`), `catalog/hooks` (`useStoreProducts`, `useOpsProducts`, `useCategories`), `catalog/mutations` (API wrappers), `tracking/useTracking`, `notifications/*`. |
| `src/features/auth/` | `AuthProvider` (`useAuth`, `useSignedInUser` for ops, `useSupplier` for the portal), `LoginPage`, `SetPasswordPage`, `ResetPasswordPage`, `AuthLayout`, `auth-errors`. |
| `src/app/` | `router.tsx` (every route), `guards/guards.tsx` (`RequireStaff`, `RequireSupplier`, `RequireAdmin`, `RequireStoreOwner`, `SessionSplash`), `layouts/Shell.tsx` (frame shared by ops and portal), `layouts/AppLayout.tsx` (ops sidebar and badges), `RouteError` (inline per page). |
| `src/portal/` | `PortalLayout` (sidebar, store name, "Pause new orders", bell), `OwnerOutlet`, `pages/*`. Portal-only components go in `src/portal/components/` (the pick slip is `PickSlip.tsx` there, MARKETPLACE §12.5). |
| `src/components/ui/` | design system (below). |
| `src/components/map/` | `AppMap` (declarative, CLIENTS §7.2 props), `BaseMap` pieces (`FitBounds`, `FlyTo`, `ClickToPick`, `AnimatedMarker`, `InvalidateOnResize`, `DEFAULT_CENTER` = Toronto), `markers.ts`, `map-types.ts` (`fitKeyFor`). |
| `src/features/files/SignedImage.tsx` | `<img>` over `useFileUrl` for proofs, issue photos, quote attachments. |

Folder rule: `frontend/` imports `@instasupply/shared`, `@instasupply/art` and `@instasupply/api-client`
only; never `backend/`, `app/` or `legacy/`. Domain rules (pricing, refunds, status machines, time zone,
formatting) come from `@instasupply/shared`: never re-implement them in a screen. Missing something in
`shared` or `api-client`? Ask for it; do not copy it.

## 3. Data rules

1. **Never build a URL or a topic.** Reads: `useLiveQuery(queries.x(…))` (live: topics plus polling
   while the socket is down), `useApiQuery` (no topics), `usePagedQuery(queries.x(filters))` for paged
   lists (`items`, `hasMore`, `loadMore`, `loadingMore`). Writes: `api.call('commandName', input)` or
   `api.<resource>.<fn>` (CLIENTS §4.2), usually through `useApiMutation`.
2. **Every query renders three states.** Use `<QueryView query={…} empty={…}>` from `ui/Data`, or the
   pieces: `PageSpinner` on first load, `<ErrorState error={q.error} onRetry={q.retry} />` when nothing
   is usable, `EmptyState`. Data already on screen stays during a refetch (`refreshing`).
3. **Not found is not a network error.** A document query's `data` is null while loading, disabled or
   missing. Show "not found" only when `!loading && !error && data === null`; show "Can't reach the
   server" with retry for `isNetworkError(error)` (verified defect R55).
4. **Errors are shown with `describeError(e)`** (alias `errorMessage`). Codes: `errorCodeOf(e)` and
   `detailsFor(e, 'CODE')` (`CODE_INCORRECT` → `remaining`, `REFUND_LIMIT`, …).
5. **Status machines are never optimistic.** Store-order actions send `expectedVersion:
   storeOrder.version`; on `VERSION_CONFLICT` call `api.cache.invalidate(['store-order', id])` and tell
   the user it changed. Buttons show `mutation.busy`; a second click returns the same promise.
   Optimistic updates only where CLIENTS §1.12 lists them (read flags, chat/support sends, on-hand
   nudges, active toggle, "Pause new orders"), through `useApiMutation({ optimistic })`.
6. **Retry-safety.** Commands that create things take a client id (`api.newRequestId()`), generated
   once per user intent and reused on retry (D17). `api.products.adjustStock` is not retry-safe: after a
   lost answer reload the product before adjusting again.
7. **Lists that must be complete** (portal board, open deliveries, job board) are single `useLiveQuery`
   lists; history is paged with `LoadMore`. Never count a capped list as a total: KPIs and badges come
   from `useOpsDashboard()` (verified defects R47, R48).
8. **User rows** (`GET /users`) carry `uid`; `useDrivers`, `useStaff` and `useDriver` add `id = uid` so
   `indexById` and `key={row.id}` work. Elsewhere use `uid`.
9. **Time.** All `…At` values are epoch ms (`toMillis` still works). Show Toronto time with the `…ET`
   formatters of shared (`formatClockET`, `formatDateTimeET`, `formatWindowET`). Countdowns to server
   deadlines use `<Countdown deadline={…} />` or `useServerNow()` (server-corrected clock), never
   `Date.now()`.
10. **Money** is integer cents in CAD: `<Money cents={…} />` or `formatMoney`. Totals come from the
    server or from `priceCheckout` / `refundForLines` in shared. No COD, no ₹ (MARKETPLACE §12.5).
11. **Files.** Private images: `<SignedImage path={…} alt="…" />` or `useFileUrl(path)`. Uploads:
    `api.upload({ purpose, ownerId, source })`, then send the returned `path` in the write.

## 4. Session and routes

- `useAuth()` gives `status`, `role` (`admin` | `dispatcher` | `supplier`), `profile`, `storeId`,
  `storeRole`, `store`, `isAdmin`, `isStaff`, `isSupplier`, `isStoreOwner`, `signOut()`. Ops screens
  call `useSignedInUser()`; portal screens call `useSupplier()` (throws outside the guard, by design).
- Drivers, customers, inactive accounts and suppliers without a store are signed out at once with the
  CLIENTS §2.7 message. Suppliers are redirected from ops routes to `/portal`; staff from `/portal` to `/`.
  Another tab signing in as someone else reloads this one.
- `/set-password#token=isp_…` reads the fragment once, removes it from the address bar, inspects the
  invite and signs the user in. `/reset-password` runs the 6-digit-code flow. `/track/:token` is public.
- Each page route has an inline error element: a crash keeps the sidebar (R40).

### Route → file

"Placeholder" files contain only `ScreenPlaceholder`: replace the whole file. "Old screen" files are
the pre-marketplace console: rewrite them for the marketplace spec (they do not type-check yet).

| Route | File | State |
| --- | --- | --- |
| `/` | `features/dashboard/DashboardPage.tsx` (+ `NeedsAttention`, `ActivityFeed`) | old screen |
| `/live` | `features/live-map/LiveMapPage.tsx` | old screen (compiles) |
| `/jobs` | `features/jobs/JobsPage.tsx` | placeholder |
| `/deliveries`, `/deliveries/:deliveryId` | `features/deliveries/DeliveriesPage.tsx`, `detail/DeliveryDetailPage.tsx` | old screen |
| `/drivers`, `/drivers/:driverId` | `features/drivers/DriversPage.tsx`, `DriverDetailPage.tsx` | old screen (add payout account, held entries, ledger, sessions) |
| `/messages`, `/messages/:driverId` | `features/messages/MessagesPage.tsx`, `Conversation.tsx` | old screen |
| `/orders`, `/orders/:orderId` | `features/orders/OrdersPage.tsx`, `OrderDetailPage.tsx` | old screen (rewrite, hooks ready) |
| `/stores`, `/stores/new`, `/stores/:storeId` | `features/stores/*` | placeholder |
| `/catalog` | `features/catalog/CatalogPage.tsx` (→ `CatalogWorkspace` shared with the portal) | old screen |
| `/quotes`, `/quotes/:quoteId` | `features/quotes/*` | placeholder |
| `/issues`, `/issues/:issueId` | `features/issues/*` | placeholder |
| `/support`, `/support/:threadId` | `features/support/SupportPage.tsx` | placeholder |
| `/suggestions` | `features/suggestions/SuggestionsPage.tsx` | placeholder |
| `/payouts` | `features/payouts/PayoutsPage.tsx` | placeholder |
| `/team` (admin) | `features/team/TeamPage.tsx` | old screen (add suspend/restore, sessions, revoke) |
| `/outbox` | `features/outbox/DevOutboxPage.tsx` | ported |
| `/portal` | `portal/pages/OrdersBoardPage.tsx` | placeholder |
| `/portal/orders/:storeOrderId` | `portal/pages/StoreOrderPage.tsx` | placeholder |
| `/portal/catalog`, `/portal/store`, `/portal/support` | `portal/pages/PortalCatalogPage.tsx`, `StoreProfilePage.tsx`, `PortalSupportPage.tsx` | placeholder |
| `/portal/payouts`, `/portal/insights`, `/portal/team` (owner) | `portal/pages/PortalPayoutsPage.tsx`, `InsightsPage.tsx`, `PortalTeamPage.tsx` | placeholder |
| `/track/:token` | `features/tracking/TrackingPage.tsx` (+ `TrackingMap`, `ProgressSteps`) | old screen (compiles; marketplace copy and fixes to do) |
| `/login`, `/set-password`, `/reset-password` | `features/auth/*` | done |

Add a route only in `app/router.tsx` with `screen(path, () => import(…))`; add its sidebar entry in
`AppLayout.tsx` or `PortalLayout.tsx`.

## 5. Design system (`src/components/ui`)

Keep the existing language: Inter, indigo `brand-*`, slate neutrals, `rounded-2xl` cards with
`shadow-card`, `PageHeader` + `Card`/`CardHeader`/`CardBody`/`DetailRow`, `Badge` tones
(`neutral | info | brand | warning | success | danger`), `Tabs`, `Segmented`, `Toggle`, `Popover` +
`MenuItem` for action menus (destructive item last, after a divider). Icons only from `ui/icons.ts`
(semantic names; add there). New in this foundation:

| Component | Use |
| --- | --- |
| `Data.tsx`: `QueryView`, `LoadMore` | loading, error with retry, empty, content; "Load more" for paged lists |
| `Countdown.tsx`: `Countdown`, `useServerNow`, `formatCountdown` | "Accept within 7:42" (amber < 10 min, red < 5 min, "Overdue" after) |
| `Money.tsx` | cents → `$1,234.50`, tabular figures |
| `CopyField.tsx` | `passwordSetupLink`, tracking links |
| `ConfirmDialog.tsx` | one confirmed action; its error shows inside the dialog |
| `LiveStatus.tsx`: `LiveStatusBar` | already in both headers |
| `ScreenPlaceholder.tsx` | placeholders only |
| `Feedback.tsx` | `ErrorState` now takes any error and `onRetry`; `Callout` has `tone="danger"` |
| `Modal.tsx` | `dismissOnBackdrop={false}` for form modals with a draft |

**Dialogs.** A backdrop click closes a modal only when press and release are both on the backdrop
(R38: panning a map or selecting text no longer wipes a form). Toasts render inside the innermost open
dialog, so they are readable and clickable over it (R52), but show a dialog's own errors inline with a
`Callout` and keep the dialog open. Reset a form draft only after success or an explicit Cancel.

**Maps.** `<AppMap markers polylines circles fit pick onPick onMarkerPress accessibilityLabel className="h-80" />`.
Tiles and attribution come from `useConfig().map`; never hard-code a tile URL. `fit.key` from
`fitKeyFor(points)` so live updates do not fight the user's panning. The attribution must stay visible.

**Notifications.** The bell, toasts and desktop notifications route with
`notificationHref(item, 'staff' | 'supplier')` (CLIENTS §6.4). The console has no system push in P0, so
there is no device registration on the web.

## 6. Verified defects to fix in your screen

From the review of the pre-marketplace console (`code-review-I`, `backoffice-commerce-findings`). The
foundation fixed R38, R40, R52 (shared parts), R55 (hooks), the 500-row caps in shared hooks, the
silent revert of R42 in `EditDeliveryModal` (only changed fields are sent), the false "driver
notified" toast (R41/R43), and category reorder ties (correctness #1: `saveCategoryOrder` sends the
full order). Still to do in the screens:

| Screen | Do |
| --- | --- |
| Create delivery | refuse submit without a pin (R39), as Edit does; show where the pin landed |
| CSV import | send `createDeliveries` in chunks with a stable import id per file, never re-enable Import after a timeout or transport error, say "may still be running" with a link to Deliveries (R44, R49 to R51); list ignored and duplicate columns before importing, show Phone in the preview (R45); no COD column |
| Tracking page | count down from the location fix, show "Waiting for an update from your driver" when the fix is older than `LOCATION_STALE_MS`, never "Arriving in 1 min" forever, "Arriving any minute" at 0 (R46, R53); `connecting` vs `notFound` from `useTracking` (R55); MARKETPLACE §9 phase text, store pin, hand-off code |
| Deliveries, dashboard | failed work comes from `useFailedStoreOrders()` with no date bound (R54); counts from `useOpsDashboard()`; "showing first N" where a list is capped (R47, R48) |
| Catalog | freeze row order and membership while editing inline (ux #1); a count below `reserved` asks to confirm |
| Order detail | stacked order Fulfilment → Customer → Payment → Items (ux #7); one Actions menu, destructive last (ux #6); staff status wording (ux #4); failed orders offer resolve/cancel (`resolveFailedDelivery`) (ux #3, correctness #2) |
| Delivery detail | cancelling a delivery linked to a store order says what happens to the order (ux #2); linked order card after the assignment panel (ux #10) |
| Pick slip (portal) | visible ✓ header, "Size", darker rules, order number repeated per printed page (ux #12) |
| Categories | keep focus on the moved row and announce its position (ux #8) |
| KPI tiles | one `Tile`/`Amount` component, whole-dollar figures that fit at 390 px (ux #5) |

## 7. Type-check status at handover

`npm --workspace @instasupply/frontend run typecheck` reports 175 errors, all inside these 45 files of
old screens (§4), which their builders rewrite:

- `features/catalog/`: `CatalogPage.tsx`, `catalog-filters.ts`, `category-form.ts`, `product-form.ts`,
  `components/{CategoriesTab, CategoryFormModal, DeleteProductDialog, FlagSwitch, ProductCardList,
  ProductFormModal, ProductParts, ProductPreview, ProductTable, ProductsTab, StockEditor}.tsx`
- `features/deliveries/`: `DeliveriesPage.tsx`, `components/{DeliveriesTable.tsx, DeliveryFormFields.tsx,
  delivery-form.ts}`, `detail/{DeliveryDetailPage, DeliverySummary, ProofCard, StaffActions, Timeline}.tsx`
- `features/drivers/`: `DriversPage.tsx`, `DriverDetailPage.tsx`
- `features/messages/Conversation.tsx` (`sendStaffMessage` no longer takes sender fields; the server
  stamps them)
- `features/orders/`: `OrdersPage.tsx`, `OrderDetailPage.tsx`, `order-format.ts`, `orders-csv.ts`,
  `components/{CancelOrderModal, CustomerCard, FulfilmentCard, ItemThumb, LinkedOrderCard, OrderActions,
  OrderBadges, OrderItemsCard, OrderKpis, OrderProgress, OrdersTable, PackingSlip, PaymentCard}.tsx`
- `features/team/TeamPage.tsx`

Everything else type-checks. `vite build` also fails on those files (missing exports) until they are
rewritten.
