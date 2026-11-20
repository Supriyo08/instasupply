import { fromLocal, toLocal, toMillis, type Delivery, type LatLng, type Priority } from '@instasupply/shared';

/**
 * Editable form state of a manual delivery; numbers stay strings until validation so inputs behave
 * naturally. There is no cash on delivery in the marketplace (MARKETPLACE §12.5): cards only.
 */
export interface DeliveryDraft {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  location: LatLng | null;
  /** The geocoder's label for the pin, when it came from "Find address" (shown as where the pin landed). */
  locationLabel: string | null;
  addressNotes: string;
  notes: string;
  packageCount: string;
  priority: Priority;
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
  locationLabel: null,
  addressNotes: '',
  notes: '',
  packageCount: '1',
  priority: 'normal',
  requireCode: false,
  windowStart: '',
  windowEnd: '',
  driverId: null,
};

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * `datetime-local` value ↔ epoch ms, always in Toronto time (MARKETPLACE §4.1), whatever the time zone
 * of the dispatcher's computer.
 */
export function toLocalInput(millis: number | null): string {
  if (millis == null) return '';
  const local = toLocal(millis);
  return `${local.date}T${pad(Math.floor(local.minutes / 60))}:${pad(local.minutes % 60)}`;
}

export function fromLocalInput(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  try {
    return fromLocal(match[1]!, hours * 60 + minutes);
  } catch {
    return null;
  }
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
    locationLabel: null,
    addressNotes: delivery.addressNotes ?? '',
    notes: delivery.notes ?? '',
    packageCount: String(delivery.packageCount ?? 1),
    priority: delivery.priority,
    requireCode: delivery.requireCode,
    windowStart: toLocalInput(toMillis(delivery.windowStart)),
    windowEnd: toLocalInput(toMillis(delivery.windowEnd)),
    driverId: delivery.driverId,
  };
}
