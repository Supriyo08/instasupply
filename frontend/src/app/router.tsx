/**
 * Every route of the console (docs/CLIENTS.md §4.4, §4.5, §2.7; MARKETPLACE §8, §9). Each screen is its
 * own lazy chunk, and each one has an in-layout error element, so a page that fails to load or render
 * keeps the sidebar and header (verified defect R40). frontend/CONVENTIONS.md maps routes to files.
 */
import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';

import { PageSpinner } from '@/components/ui/Feedback';

import { RouteError } from './RouteError';

type Loader = () => Promise<{ default: ComponentType }>;

/** Lazy-load a route module so each screen ships as its own chunk. */
const page = (load: Loader) => async () => {
  const module = await load();
  return { Component: module.default };
};

/** A screen inside a layout: lazy, with the inline error element. */
const screen = (path: string | undefined, load: Loader, children?: RouteObject[]): RouteObject =>
  path === undefined
    ? { index: true, lazy: page(load), errorElement: <RouteError inline /> }
    : { path, lazy: page(load), errorElement: <RouteError inline />, children };

const opsRoutes: RouteObject[] = [
  screen(undefined, () => import('@/features/dashboard/DashboardPage')),
  screen('live', () => import('@/features/live-map/LiveMapPage')),
  screen('jobs', () => import('@/features/jobs/JobsPage')),
  screen('deliveries', () => import('@/features/deliveries/DeliveriesPage')),
  screen('deliveries/:deliveryId', () => import('@/features/deliveries/detail/DeliveryDetailPage')),
  screen('drivers', () => import('@/features/drivers/DriversPage')),
  screen('drivers/:driverId', () => import('@/features/drivers/DriverDetailPage')),
  screen('messages', () => import('@/features/messages/MessagesPage')),
  screen('messages/:driverId', () => import('@/features/messages/MessagesPage')),
  screen('orders', () => import('@/features/orders/OrdersPage')),
  screen('orders/:orderId', () => import('@/features/orders/OrderDetailPage')),
  screen('stores', () => import('@/features/stores/StoresPage')),
  screen('stores/new', () => import('@/features/stores/NewStorePage')),
  screen('stores/:storeId', () => import('@/features/stores/StoreDetailPage')),
  screen('catalog', () => import('@/features/catalog/CatalogPage')),
  screen('quotes', () => import('@/features/quotes/QuotesPage')),
  screen('quotes/:quoteId', () => import('@/features/quotes/QuoteBuilderPage')),
  screen('issues', () => import('@/features/issues/IssuesPage')),
  screen('issues/:issueId', () => import('@/features/issues/IssueDetailPage')),
  screen('support', () => import('@/features/support/SupportPage')),
  screen('support/:threadId', () => import('@/features/support/SupportPage')),
  screen('suggestions', () => import('@/features/suggestions/SuggestionsPage')),
  screen('payouts', () => import('@/features/payouts/PayoutsPage')),
  {
    path: 'team',
    lazy: page(() => import('./AdminOutlet')),
    errorElement: <RouteError inline />,
    children: [screen(undefined, () => import('@/features/team/TeamPage'))],
  },
  screen('outbox', () => import('@/features/outbox/DevOutboxPage')),
  screen('*', () => import('./NotFoundPage')),
];

const portalRoutes: RouteObject[] = [
  screen(undefined, () => import('@/portal/pages/OrdersBoardPage')),
  screen('orders/:storeOrderId', () => import('@/portal/pages/StoreOrderPage')),
  screen('catalog', () => import('@/portal/pages/PortalCatalogPage')),
  screen('store', () => import('@/portal/pages/StoreProfilePage')),
  screen('support', () => import('@/portal/pages/PortalSupportPage')),
  {
    lazy: page(() => import('@/portal/OwnerOutlet')),
    errorElement: <RouteError inline />,
    children: [
      screen('payouts', () => import('@/portal/pages/PortalPayoutsPage')),
      screen('insights', () => import('@/portal/pages/InsightsPage')),
      screen('team', () => import('@/portal/pages/PortalTeamPage')),
    ],
  },
  screen('*', () => import('./NotFoundPage')),
];

export const router = createBrowserRouter([
  // Public customer tracking page: signed out, no session code.
  {
    path: '/track/:token',
    lazy: page(() => import('@/features/tracking/TrackingPage')),
    hydrateFallbackElement: <PageSpinner />,
    errorElement: <RouteError />,
  },
  {
    lazy: page(() => import('./StaffRoot')),
    hydrateFallbackElement: <PageSpinner />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', lazy: page(() => import('@/features/auth/LoginPage')) },
      { path: '/set-password', lazy: page(() => import('@/features/auth/SetPasswordPage')) },
      { path: '/reset-password', lazy: page(() => import('@/features/auth/ResetPasswordPage')) },
      // The supplier portal: its own layout and guard, next to (not inside) the ops layout (MARKETPLACE §8).
      { path: '/portal', lazy: page(() => import('@/portal/PortalLayout')), children: portalRoutes },
      { path: '/', lazy: page(() => import('./ProtectedLayout')), children: opsRoutes },
    ],
  },
]);
