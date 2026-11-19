# InstaSupply — Architecture

InstaSupply is a grocery delivery platform with these parts:

| Part | Folder | Stack | Who uses it |
| --- | --- | --- | --- |
| Shopping app | `apps/customer` | Expo SDK 58 · React Native 0.88 · Expo Router · Firebase JS SDK · react-native-svg | Shoppers (iOS, Android, web) |
| Driver app | `apps/driver` | Expo SDK 58 · React Native 0.88 · Expo Router · Firebase JS SDK | Delivery drivers (iOS, Android, web) |
| Back office | `apps/backoffice` | Vite · React 19 · React Router 7 · Tailwind CSS 4 · Leaflet · Firebase JS SDK | Admins and dispatchers, plus the public customer tracking page |
| Backend | `firebase/` | Cloud Functions v2 (Node 22) · Firestore · Auth · Storage · FCM | Everything server-side |
| Shared domain | `packages/shared` | Plain TypeScript, no runtime deps | Imported by all of the above |
| Illustrations | `packages/art` | Hand-built SVG, compiled to a typed module | Product, category and scene artwork in every app |
| Expo Firebase kit | `packages/expo-firebase` | Firebase JS SDK + React Native persistence | Client setup, emulator discovery and realtime hooks for the Expo apps |

All business rules that more than one app needs live once in `@instasupply/shared`: the delivery
and order status machines, cart pricing and promo codes, input validation, the route optimizer and
formatting. The server re-runs the same pricing code, so the app and the checkout always agree.

## Folder layout

```
instasupply/
├── apps/
│   ├── customer/               Expo shopping app
│   │   └── src/
│   │       ├── app/            Expo Router routes: (intro) · (auth) · (setup) · (shop)
│   │       ├── features/       session · catalog · cart · favorites · addresses · cards · orders · notifications …
│   │       ├── components/     ui/ (Big Cart design system), catalog/, brand/, navigation/
│   │       ├── lib/            firebase client, typed callables, env
│   │       └── theme/          colours, gradient, Poppins type scale, spacing, shadows
│   ├── driver/                 Expo driver app
│   │   └── src/
│   │       ├── app/            Expo Router routes only (screens are thin)
│   │       ├── features/       auth · deliveries · route · chat · notifications · location · profile
│   │       ├── components/     ui/ (design system) and shared composites
│   │       ├── lib/            firebase client, storage, utilities
│   │       └── theme/          colors, spacing, typography (light + dark)
│   └── backoffice/             Vite web app
│       └── src/
│           ├── app/            router, layouts, guards
│           ├── features/       auth · dashboard · deliveries · orders · catalog · drivers · live-map · messages · notifications · team · tracking · outbox
│           ├── components/     ui/ (design system), map/
│           └── lib/            firebase client, hooks, utilities
├── packages/
│   ├── shared/                 domain model + pure logic (unit tested)
│   ├── art/                    svg/*.svg → src/generated.ts (npm run build in the package)
│   └── expo-firebase/          Firebase client + hooks shared by the Expo apps
├── firebase/
│   ├── functions/src/
│   │   ├── config/             typed runtime configuration & secrets
│   │   ├── lib/                admin SDK, auth guards, errors, ids
│   │   └── modules/            auth · commerce · deliveries · routing · tracking · notifications · chat · geocoding · sms · maintenance
│   ├── firestore.rules         role-based security rules
│   ├── firestore.indexes.json  composite indexes + TTL-friendly field overrides
│   ├── storage.rules           proof-of-delivery uploads
│   └── tests/                  security-rules + callable/trigger workflow tests (emulators)
├── infra/                      project bootstrap scripts (APIs, secrets, TTL, backups)
├── scripts/                    seed data, driver simulator, create-admin, import-catalog
├── .github/workflows/          CI, deploy, mobile builds
└── docs/                       this file, DEPLOYMENT.md
```

## Roles and authentication

Roles are Firebase Auth **custom claims** (`role: admin | dispatcher | driver | customer`, plus
`active` once approved) set only by Cloud Functions, so security rules never need an extra document read.
Account state is mirrored in `users/{uid}.status` (`pending | active | suspended`), which the apps
watch to move drivers through onboarding in real time.

* **Shoppers** sign up with email + password in the shopping app. The `registerCustomer` callable
  creates their profile and sets the `customer` claim. They are active straight away, but must
  verify their phone number before the first checkout. Each app rejects accounts of another role
  with a clear "wrong app" screen.
* **Drivers** sign up with email + password in the app, then the `registerDriver` callable creates
  their profile (`status: pending`) and sets the `driver` claim.
* **Phone verification** uses our own OTP flow (`requestPhoneOtp` / `verifyPhoneOtp`): 6-digit codes
  stored as HMAC hashes, 5-minute expiry, 5 attempts, 30-second resend cooldown and an hourly send
  cap. SMS goes through Twilio in production. In the emulator the code is returned to the client and
  written to the dev outbox; configured test numbers always accept `123456`.
* **Approval:** a new driver can't see work until an admin approves them in the back office
  (`setDriverStatus`). Suspending a driver revokes their refresh tokens and takes them offline.
* **Back office** access requires the `admin` or `dispatcher` claim. Only admins can manage the
  team (`createStaffUser`) and approve or suspend drivers.

## Data model (Firestore)

| Path | Written by | Read by | Notes |
| --- | --- | --- | --- |
| `users/{uid}` | functions; owner may edit `displayName`, `vehicle`, `preferences` | owner, staff | profile, role, status, stats |
| `users/{uid}/devices/{installationId}` | owner | owner | push tokens (`fcm` or `expo`), pruned automatically when invalid |
| `driverLocations/{uid}` | the driver | staff, the driver | live position, heading, speed, `online` |
| `deliveries/{id}` | functions; staff may edit contact/notes fields | staff, assigned driver | the order itself |
| `deliveries/{id}/events/{eventId}` | functions | staff, assigned driver | audit timeline |
| `deliveries/{id}/private/meta` | functions | staff | tracking token + customer hand-off code |
| `routes/{driverId}` | functions | staff, the driver | optimized stop order, legs, ETA, polyline |
| `notifications/{id}` | functions; recipient may set `read` | recipient | in-app inbox, each one also pushed |
| `threads/{driverId}` | functions; participants reset their unread counter | staff, the driver | one dispatch ↔ driver thread |
| `threads/{driverId}/messages/{id}` | staff, the driver | staff, the driver | chat messages |
| `tracking/{token}` | functions | anyone holding the token (`get` only) | sanitized public tracking view |
| `categories/{id}` | staff | everyone (public) | name, illustration key, colours, sort order |
| `products/{id}` | staff (validated); admins delete | everyone (public) | price, MRP, stock, badge, illustration, prefix `searchTerms`, aggregated rating |
| `products/{id}/reviews/{uid}` | the shopper (one per product) | everyone | star rating + text, aggregated onto the product by a trigger |
| `orders/{id}` | functions only | the shopper, staff | priced items, totals, promo, payment, address snapshot, `statusAt`, linked `deliveryId` and `trackingToken` |
| `users/{uid}/addresses/{id}` | owner (validated) | owner | address book; checkout geocodes addresses without a pin |
| `users/{uid}/favorites/{productId}` | owner | owner | saved products |
| `users/{uid}/cards/{id}` | owner (validated) | owner | **brand, last 4 and expiry only**: the rules reject anything else |
| `otpChallenges/{uid}`, `counters/*` | functions | nobody | server-only |
| `devOutbox/{id}` | functions (emulator / no SMS provider) | staff | SMS that would have been sent |

### Delivery lifecycle

```
unassigned ──assign──▶ assigned ──accept──▶ accepted ──▶ picked_up ──▶ in_transit ──▶ arrived ──▶ delivered
     ▲                    │ decline                         │               │            │
     └────────────────────┘                                 └───────────────┴────────────┴──▶ failed ──reassign──▶ assigned
any non-terminal state ──staff──▶ cancelled
```

* Drivers change status only through callables (`updateDeliveryStatus`, `completeDelivery`). The
  server validates every transition against `canTransition()` from the shared package, stamps the
  matching timestamp (`acceptedAt`, `deliveredAt`, …), and writes an audit event.
* Only one delivery per driver is `in_transit` at a time. Starting a new trip parks the previous
  one back to `picked_up`, so the customer ETA always refers to the stop the driver is heading to.
* **Proof of delivery:** recipient name, an optional photo (Storage `proofs/{deliveryId}/…`), cash
  collected for COD orders, and, when `requireCode` is set, the 4-digit hand-off code the customer
  sees on their tracking page.

## Shopping and orders

1. **Browsing** needs no account: the catalogue is public. Search uses prefix terms stored on each
   product (`array-contains`), so it works without a search service.
2. **Cart** lives on the device (AsyncStorage) and is priced live with `priceCart()` from the shared
   package: subtotal, delivery fee (free from ₹499), promo discount and the "add ₹X for free
   delivery" meter.
3. **Checkout** calls `placeOrder` with product ids, quantities, an address id, the payment method
   and an optional promo code. Client prices are ignored. In one Firestore transaction the
   function:
   - checks that the shopper is active and phone-verified
   - checks that every product is active and in stock
   - re-prices the cart, including the first-order rule for `FIRST20`
   - decrements stock
   - creates the delivery, with the COD amount and a required hand-off code
   - creates the order, numbered like deliveries (`IS-10042`)

   Then it notifies the shopper and staff.
4. **Fulfilment** reuses the delivery pipeline: dispatch assigns a driver, the driver moves the
   delivery through its states, and `onDeliveryWritten` keeps the order in step:

   | Delivery | Order |
   | --- | --- |
   | `unassigned` | `placed` |
   | `assigned`, `accepted` | `confirmed` |
   | `picked_up` | `packed` |
   | `in_transit`, `arrived` | `out_for_delivery` |
   | `delivered` | `delivered` (COD becomes `collected`) |
   | `failed` / `cancelled` | `failed` / `cancelled` |

   The order never moves backwards, and every change notifies the shopper. "Driver arrived" also
   triggers a heads-up.
5. **Tracking**: the order holds the delivery's tracking token, so the app reads the same sanitized
   `tracking/{token}` document as the public page: driver position and heading, ETA, progress and
   the hand-off code the shopper gives the driver.
6. **Cancelling**: shoppers can cancel with `cancelOrder` until the driver picks the order up. The
   store can cancel any open delivery from the back office. Both paths return the stock and mark
   card payments `refund_pending`.
7. **Payments**: cash on delivery always works. Card payments are simulated when
   `PAYMENTS_MODE=test` (the emulator default) and disabled in production until a gateway is
   connected. A full card number never reaches the backend or the database.
8. **Reviews**: one review per shopper per product. `onReviewWritten` recalculates the product's
   average rating and count.

## Side effects (Firestore triggers)

* `onDeliveryWritten` keeps `tracking/{token}` and the linked shop order in sync, notifies the new and previous driver when
  the assignment changes, notifies staff about declines, failures and completions, sends the
  customer their tracking link when the trip starts, updates driver stats, and re-plans the
  affected drivers' routes.
* `onDriverLocationWritten` pushes the driver position and a fresh ETA into the tracking documents
  of their active deliveries. It is throttled so it doesn't run on every GPS tick.
* `onNotificationCreated` fans out push messages to every registered device (FCM and Expo push),
  records the outcome on the notification, and deletes dead tokens.
* `onChatMessageCreated` updates thread summaries and unread counters and notifies the other side.
* `onReviewWritten` keeps each product's average rating and review count current.

## Route optimization

`optimizeRoute` (callable, plus the delivery trigger) builds a travel-time matrix from the driver's
live position to every active stop and runs **nearest-neighbour + 2-opt + relocate** local search
with priority weighting and time-window penalties (`packages/shared/src/route-optimizer.ts`). The
stop the driver is already heading to stays first. Matrix providers:

1. **Google Routes API** (`computeRouteMatrix`, traffic-aware) when `GOOGLE_MAPS_API_KEY` is set
   server-side. The key never ships in an app bundle.
2. **OSRM** when `ROUTING_PROVIDER=osrm` (self-hosted or the public demo server, development only).
3. **Estimate** fallback: haversine distance × road factor ÷ city speed. It always works.

The result is stored in `routes/{driverId}`, so the driver app and the back office live map draw the
same plan.

## Live tracking

1. When a driver goes online the app streams position to `driverLocations/{uid}`. It updates about
   every 15 s or 30 m, tightening to about 5 s or 10 m while a trip is in transit. Native builds also
   register a background location task with an Android foreground-service notification.
2. The back office live map subscribes to `driverLocations` and animates markers smoothly. It marks
   drivers stale after 2 minutes without an update.
3. Shoppers follow their order on a live map in the shopping app. Customers of deliveries created
   by dispatch open `/track/{token}` (a public page in the back office app). Both show the driver
   moving, the ETA, the progress timeline and the hand-off code. Neither shows the driver's other
   stops or personal details.

## Messaging

* **Push:** every device registers under `users/{uid}/devices`. Native builds with
  `google-services.json` register an **FCM** token. Builds with an EAS project ID register an
  **Expo push token**, which covers APNs on iOS. The function routes each token to the right
  provider and removes invalid ones.
* **Inbox:** every push is backed by a `notifications` document, so nothing is lost if push is
  disabled, and the apps show unread badges in real time.
* **Chat:** a dispatch ↔ driver thread with quick replies, linked deliveries and unread counters.
* **Customer SMS:** the tracking link is sent when a trip starts (Twilio, or the dev outbox locally).

## Environments

| Environment | Firebase project | How |
| --- | --- | --- |
| local | `demo-instasupply` (emulators, no cloud resources) | `npm run emulators` + `npm run seed` |
| staging | alias `staging` in `.firebaserc` | CI deploys `main` automatically |
| production | alias `prod` in `.firebaserc` | CI deploys tagged releases after manual approval |

See `docs/DEPLOYMENT.md` for the full production checklist.
