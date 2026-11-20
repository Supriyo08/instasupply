import {
  VEHICLE_CLASSES,
  type CartLine,
  type LoadSummary,
  type PricedStore,
  type Product,
  type VehicleClass,
} from '@instasupply/shared';
import { router } from 'expo-router';

import type { CartGroup } from '@/features/cart/useCartPricing';

const CM_PER_FOOT = 30.48;

/** "Pickup truck · 182 kg · 8 ft" (MARKETPLACE §7.3 cart row). */
export function loadLabel(load: LoadSummary, vehicleClass: VehicleClass | null): string {
  const parts = [
    vehicleClass ? VEHICLE_CLASSES[vehicleClass].label : 'Too large for one vehicle',
    `${load.weightKg} kg`,
  ];
  if (load.longestCm > 0) parts.push(`${Math.max(1, Math.round(load.longestCm / CM_PER_FOOT))} ft`);
  return parts.join(' · ');
}

/** "13.0 km" from the priced road distance, else "—". */
export function kmLabel(priced: Pick<PricedStore, 'roadKm'> | null): string | null {
  return priced?.roadKm != null ? `${priced.roadKm.toFixed(1)} km` : null;
}

/** The store's lines as material-list text: "24 × 2x4x8 SPF stud (2 in × 4 in × 8 ft)". */
export function materialListText(lines: readonly { line: CartLine; product: Product | null }[]): string {
  return lines
    .filter((entry) => entry.product)
    .map(({ line, product }) => {
      const item = product as Product;
      return `${line.quantity} × ${item.name}${item.size ? ` (${item.size})` : ''}`;
    })
    .join('\n');
}

/**
 * "Send as a material list": opens the material-list form with this store's lines filled in
 * (`?items=` one line per item, `?storeId=`), so a load too large for one vehicle is quoted instead.
 */
export function sendAsMaterialList(group: CartGroup) {
  router.push({
    pathname: '/quotes/new',
    params: { items: materialListText(group.lines), storeId: group.storeId },
  });
}
