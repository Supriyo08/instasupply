# app/driver: conventions for screen builders

The foundation of the driver app is on the API (`packages/api-client`); Firebase is gone. This file
says what exists, where it is, and the rules every screen follows. Specs: MARKETPLACE §10 (screens),
§12.6; CLIENTS §2.3 to §2.5, §3.1, §3.3, §4.6 (what each screen reads and calls), §5 (location),
§6 (push), §7 (maps), §8.2 (env). Read your screen's row in CLIENTS §4.6 first: a screen needs nothing
that is not named there.

## Run it

```bash
npm run dev:backend          # API on :4000 (root of the repo; PostgreSQL 17 local, no password)
npm run dev:driver           # Expo; press w for the web, a for an Android emulator
npm run dev:driver:web       # web only
```

`EXPO_PUBLIC_API_URL` is empty in `.env.development`: the app finds the API on the dev machine (LAN
address from the Expo dev server, `10.0.2.2` on the Android emulator, `localhost` on the web). Put an
override in `.env.local` (git-ignored). Release bundles read `.env.production` and must be `https://`;
`app.config.ts` refuses anything else at build time. Seeded accounts: MARKETPLACE §11.

Checks before you hand over (all must be clean for your files):

```bash
cd app/driver && npx tsc --noEmit -p .
npx eslint app/driver                          # from the root
npx prettier --check "app/driver/**/*.{ts,tsx}"
cd app/driver && npx expo export --platform android
```

## Routes

| Route | File | State |
| --- | --- | --- |
| `(auth)/sign-in`, `sign-up` | `src/app/(auth)/*` | ported; sign-in shows why a session ended (`endReasonMessage`) |
| `(auth)/forgot-password` | | ported, two steps (code from the email, new password) |
| `onboarding/profile` → `vehicle` → `attest` | `src/app/onboarding/*` | built. All three are `needs_profile`; nothing is sent until attest |
| `onboarding/verify-phone`, `pending` | | NANP copy; pending asks for push permission (R59) |
| `onboarding/account` | | ported: staff, customer, supplier and suspended accounts |
| `(tabs)/jobs`, `(tabs)/earnings` | `src/app/(app)/(tabs)/*` | **placeholders** |
| `(tabs)/index` (Today), `(tabs)/route`, `(tabs)/chat` | | **placeholders** |
| `job/[id]` | `src/app/(app)/job/[id].tsx` | **placeholder** |
| `delivery/[id]`, `delivery/[id]/complete` | `src/app/(app)/delivery/[id]/*` | **placeholders** |
| `delivery/[id]/fail` | | compiles on the new hooks; check it against MARKETPLACE §10 |
| `profile` | `src/app/(app)/profile.tsx` | minimal (name, city, vehicle row, sign-out); extend it |
| `vehicle` | `src/app/(app)/vehicle.tsx` | **placeholder** |
| `history`, `notifications` | `src/app/(app)/*` | ported (paged history, optimistic mark-read) |

Each placeholder lists the hooks it should use. The Firebase-era versions of the screens are in git
(`git show HEAD:app/driver/src/app/(app)/(tabs)/index.tsx` and so on) for layout ideas only; their
data code and COD fields must not come back.

## Data: the only ways to read and write

- **Reads** go through hooks in `src/features/*/hooks.ts`, each one descriptor of `queries` (CLIENTS
  §4.1). If your screen needs a read that has no hook, add the hook next to the others; never call
  `fetch`, never write a URL path or a topic string in a screen.
  - `useLiveQuery` for anything with topics, `usePagedQuery` for "(paged)" lists, both from
    `@instasupply/api-client/react`. A result is `{ data, loading, error, retry, refreshing, updatedAt }`
    (paged: `{ items, hasMore, loadMore, loadingMore, … }`).
  - Show `loading` with `Skeleton`, `error` with `<ErrorState error={error} onRetry={retry} />`, an empty
    list with `EmptyState`. `data` is `[]` or `null` while loading, so render it without guards.
- **Commands** (`registerDriver`, `claimJob`, `checkInAtStore`, `updateDeliveryStatus`,
  `completeDelivery`, `optimizeRoute`, `updateDriverVehicle`, `sendTestNotification`, …) are wrapped
  in `src/features/deliveries/actions.ts` and `src/features/auth/auth-service.ts`. Use those; add a
  wrapper there if one is missing. `call` from `@/lib/api` is typed by name.
- **REST writes** (`api.chat.*`, `api.notifications.*`, `api.devices.*`, `api.location.*`) are used by
  the hooks only.
- Errors: `describeError(error)` for the text, `errorCodeOf(error)` for codes such as `OFFER_TAKEN`,
  `CODE_INCORRECT`, `PHOTO_REQUIRED`, `detailsFor(error, 'CODE_INCORRECT')` for their details. All from
  `@/lib/api`.
- Optimistic updates only where CLIENTS §1.12 lists them (mark read, chat send). Status changes,
  claims and completion show a busy state and then the server's answer.

| Hook | File | Data |
| --- | --- | --- |
| `useSession()`, `useDriver()` | `features/auth/SessionProvider` | status, `user` (`SessionUser`: uid, email, displayName), `profile` (`UserProfile`), `problem`, `retry`, `endReason` |
| `useOnboardingDraft`, `updateOnboardingDraft`, `resetOnboardingDraft` | `features/auth/onboarding-draft` | name, city, vehicle across the three onboarding steps |
| `useJobBoard`, `useJobOffer(id)`, `useVisibleJobs`, `sortJobs` | `features/jobs/hooks` | open offers for the driver's city and class; filters Ready now, Scheduled, Near me |
| `useActiveDeliveries`, `useDelivery(id)`, `useDeliveryEvents(id)`, `useDeliveryHistory`, `useDeliveredToday` | `features/deliveries/hooks` | |
| `useRoutePlan(uid)` | | the plan, **normalised**: a plan without `stops` is `null` (R56, R61) |
| `useOrderedStops(uid)` | | `stops` (pickup and drop-off, `kind`, `sequence`, `etaAt`), `jobs` (one entry per delivery with its `pickup` and `dropoff` stops), `route`; `nextStopOf(stops)`, `needsPickup(delivery)` |
| `useBalance`, `useUnpaidEntries`, `useLedger`, `usePayouts` | `features/earnings/hooks` | never sum a balance on the client |
| `useThread`, `useMessages`, `useSendMessage`, `useMarkThreadReadWhenVisible` | `features/chat/hooks` | messages oldest first |
| `useNotifications`, `useMarkRead`, `useMarkAllRead`, `hrefForNotification` | `features/notifications/hooks` | inbox newest first, `unread` count |
| `usePresence()` | `features/location/PresenceProvider` | `online`, `busy`, `setOnline`, `lastFix`, `error`, `currentPosition()` |
| `useNow()` | `lib/use-now` | server-corrected time; pass it to every shared formatter that takes `now` |
| `useConfig()` | `@instasupply/api-client/react` | `supportPhone` ("Call dispatch"), `phoneVerification`, map tiles |

## Rules that come from verified defects (code review J, R56 to R71)

- **Never read `plan.stops` from the raw query.** Use `useRoutePlan` or `useOrderedStops` (R56, R61).
- **Chat read state:** never call `api.chat.markRead` from a plain effect. The Dispatch tab calls
  `useMarkThreadReadWhenVisible(uid, thread.data)`, which marks read only while the tab is focused and
  the app is active (R58, R65). Send with `useSendMessage(uid, name).send(...)`; it gives every
  message its own id, so two quick replies are two messages.
- **Sign-out:** inside `(app)` use `useSignOut()`; everywhere else `signOut()` from `auth-service`.
  Both end in the same clean-up (stop the background task, forget the online switch, `POST
  /auth/logout`, which also removes the push device). Never call `api.session.signOut()` directly and
  never add an `unregisterDevice` step before it (R59, R67).
- **Location:** screens only read `usePresence()`. Do not start watchers, call expo-location for
  tracking, or touch `instasupply.online` / `instasupply.trackingMode`. The provider serialises on/off
  and survives fast toggles (R68, R69); the background task is defined in `index.ts` and guards itself
  (R60, R62); `distanceInterval` is 0 so a parked truck keeps its heartbeat (R57, R63, R64); going
  offline and signing out never wait for the network (R70, R71). For a status update's position use
  `currentPosition()`.
- **Push:** the device registers for every driver status (`PushRegistrar` in the root layout, R59); the
  system prompt is shown on entering `(app)`. The pending screen should explain why notifications
  matter and offer `registerForPush({ prompt: true })` from `features/notifications/push`; when it
  returns `denied`, say how to turn them on instead of promising a notification. Check
  `pushAvailability()` before showing anything push-specific (`PUSH_UNAVAILABLE_TEXT` otherwise).
- **COD is gone** (MARKETPLACE §12.6, R66). No cash fields anywhere.
- **Alerts:** `notify(title, message)` from `features/deliveries/useDeliveryAction` works on the web;
  `Alert.alert` with several buttons does not. Use an inline confirmation or a `Sheet` for choices.

## Maps

Import `AppMap` and the helpers from `@/components/map`; never import leaflet. Contract: CLIENTS §7.2.
One `AppMap` per screen. Give it a height (or flex) and an `accessibilityLabel` that says what it shows.
`fit.key` decides when the camera moves: build it with `fitKeyFor(points)`. For the Route tab and the
delivery preview, `features/route/route-map.ts` builds the markers (`driverMarker`, `stopMarkers`,
`routeLine`) and maps a marker id back to its delivery (`deliveryIdOfStopKey`). The job screen draws a
`store` marker and a 1 000 m `brand` circle at `offer.dropoff.approxLocation`.

## Design system

`src/components/ui` (import from `@/components/ui`): `Screen`, `Card`, `Text`, `Button`, `IconButton`,
`Input`, `Row`, `Badge` / `StatusBadge`, `Banner`, `Sheet`, `SectionHeader`, `Avatar`, `EmptyState`,
`Icon` (Ionicons), and new: `Skeleton`, `ErrorState`, `Chip` (filters, cities, vehicle types,
extras), `CheckRow` (attestations, load checklist), `Money` (cents as `$47.75`). Colours, spacing,
radii and type come from `useTheme()`; never hard-code a colour. Tabs start with `TabHeader`
(`src/components/TabHeader.tsx`): title, bell with the unread count, and the avatar that opens
`/profile`. Stack screens inside `(app)` have a native header (titles in `src/app/(app)/_layout.tsx`):
use `<Screen edges={[]}>` there. `RouteErrorBoundary` is exported by the root, `(app)` and
`onboarding` layouts.

Copy: construction, not groceries; Canadian numbers (`+1`, "e.g. CBKX 214" for plates); amounts with
`formatMoney`; times with the `…ET` formatters of shared and `useNow()`.

## Files you own and files you do not

Screen builders own their route file under `src/app/` plus new components under
`src/features/<area>/`. The foundation files (`src/lib/*`, `src/features/auth/{SessionProvider,
auth-service, home-href, onboarding-draft}.ts*`, `src/features/location/*`,
`src/features/notifications/{push*, usePushListeners*, PushRegistrar, NotificationsBridge}.ts*`,
`src/components/map/*`, the layouts, `index.ts`, `app.config.ts`) change only through the foundation
owner: ask for what you need.
