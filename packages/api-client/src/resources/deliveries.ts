import type { Delivery } from '@instasupply/shared';

import type { DeliveryPatch } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

export const deliveryPaths = {
  deliveries: '/deliveries',
  stats: '/deliveries/stats',
  delivery: (id: string) => `/deliveries/${seg(id)}`,
  events: (id: string) => `/deliveries/${seg(id)}/events`,
  private: (id: string) => `/deliveries/${seg(id)}/private`,
  activity: '/activity',
  route: (driverId: string) => `/routes/${seg(driverId)}`,
  driverLocations: '/driver-locations',
  driverLocation: (driverId: string) => `/driver-locations/${seg(driverId)}`,
  tracking: (token: string) => `/tracking/${seg(token)}`,
} as const;

export function createDeliveries(ctx: ResourceContext) {
  return {
    /** Staff only: exactly the staff-editable keys of MARKETPLACE §6.3. */
    update: (deliveryId: string, patch: DeliveryPatch) =>
      writeThen(ctx, [['delivery', deliveryId], ['deliveries']], () =>
        ctx.rest.patch<Delivery>(deliveryPaths.delivery(deliveryId), patch),
      ),
  };
}
