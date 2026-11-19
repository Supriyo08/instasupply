import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';

import { PageSpinner } from '@/components/ui/Feedback';

import { RouteError } from './RouteError';

/** Lazy-load a route module so each screen ships as its own chunk. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => {
  const module = await load();
  return { Component: module.default };
};

export const router = createBrowserRouter([
  // Public customer tracking page: no auth code, minimal bundle.
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
      {
        lazy: page(() => import('./ProtectedLayout')),
        children: [
          { index: true, lazy: page(() => import('@/features/dashboard/DashboardPage')) },
          { path: 'live', lazy: page(() => import('@/features/live-map/LiveMapPage')) },
          { path: 'deliveries', lazy: page(() => import('@/features/deliveries/DeliveriesPage')) },
          {
            path: 'deliveries/:deliveryId',
            lazy: page(() => import('@/features/deliveries/detail/DeliveryDetailPage')),
          },
          { path: 'drivers', lazy: page(() => import('@/features/drivers/DriversPage')) },
          { path: 'drivers/:driverId', lazy: page(() => import('@/features/drivers/DriverDetailPage')) },
          { path: 'orders', lazy: page(() => import('@/features/orders/OrdersPage')) },
          { path: 'orders/:orderId', lazy: page(() => import('@/features/orders/OrderDetailPage')) },
          { path: 'catalog', lazy: page(() => import('@/features/catalog/CatalogPage')) },
          { path: 'messages', lazy: page(() => import('@/features/messages/MessagesPage')) },
          { path: 'messages/:driverId', lazy: page(() => import('@/features/messages/MessagesPage')) },
          {
            path: 'team',
            lazy: page(() => import('./AdminOutlet')),
            children: [{ index: true, lazy: page(() => import('@/features/team/TeamPage')) }],
          },
          { path: 'outbox', lazy: page(() => import('@/features/outbox/DevOutboxPage')) },
          { path: '*', lazy: page(() => import('./NotFoundPage')) },
        ],
      },
    ],
  },
]);
