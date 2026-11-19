import { toMillis, type Delivery, type LatLng, type Priority } from '@instasupply/shared';

/** Editable form state; numbers stay strings until validation so inputs behave naturally. */
export interface DeliveryDraft {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  location: LatLng | null;
  addressNotes: string;
  notes: string;
  packageCount: string;
  priority: Priority;
  codAmount: string;
  requireCode: boolean;
  windowStart: string;
  windowEnd: string;
  driverId: string | null;
}

export const EMPTY_DRAFT: DeliveryDraft = {
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  address: '',
  location: null,
  addressNotes: '',
  notes: '',
  packageCount: '1',
  priority: 'normal',
  codAmount: '',
  requireCode: false,
  windowStart: '',
  windowEnd: '',
  driverId: null,
};

/** `datetime-local` value ↔ epoch ms in the browser's time zone. */
export function toLocalInput(millis: number | null): string {
  if (millis == null) return '';
  const date = new Date(millis);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

/** Shape accepted by `validateDeliveryInput`. */
export function draftToInput(draft: DeliveryDraft) {
  return {
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    customerEmail: draft.customerEmail,
    address: draft.address,
    location: draft.location,
    addressNotes: draft.addressNotes,
    notes: draft.notes,
    packageCount: draft.packageCount,
    priority: draft.priority,
    codAmount: draft.codAmount,
    requireCode: draft.requireCode,
    driverId: draft.driverId,
    windowStart: fromLocalInput(draft.windowStart),
    windowEnd: fromLocalInput(draft.windowEnd),
  };
}

export function deliveryToDraft(delivery: Delivery): DeliveryDraft {
  return {
    customerName: delivery.customer.name,
    customerPhone: delivery.customer.phone ?? '',
    customerEmail: delivery.customer.email ?? '',
    address: delivery.address,
    location: delivery.location,
    addressNotes: delivery.addressNotes ?? '',
    notes: delivery.notes ?? '',
    packageCount: String(delivery.packageCount ?? 1),
    priority: delivery.priority,
    codAmount: delivery.codAmount != null ? String(delivery.codAmount) : '',
    requireCode: delivery.requireCode,
    windowStart: toLocalInput(toMillis(delivery.windowStart)),
    windowEnd: toLocalInput(toMillis(delivery.windowEnd)),
    driverId: delivery.driverId,
  };
}
