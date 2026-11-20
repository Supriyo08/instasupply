/**
 * Wording for the supplier portal's order screens (MARKETPLACE §8). Status words and colours come from
 * `STORE_ORDER_META` in shared; this file only puts the card and detail lines together.
 */
import {
  STORE_ORDER_META,
  VEHICLE_CLASSES,
  formatClockET,
  formatDayET,
  localDateOf,
  windowLabel,
  type DriverPhase,
  type ShortReason,
  type StoreOrder,
  type StoreOrderStatus,
  type StoreRejectReason,
} from '@instasupply/shared';

/** "Whitfield Renovations", or the customer's initial and surname: "D. Whitfield". */
export function customerLabel(order: Pick<StoreOrder, 'companyName' | 'customerName'>): string {
  const company = order.companyName?.trim();
  if (company) return company;
  const parts = order.customerName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  if (parts.length === 1) return parts[0] ?? 'Customer';
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return `${first.charAt(0).toUpperCase()}. ${last}`;
}

/** The neighbourhood of the jobsite ("Leslieville" from "Leslieville · M4M"); null for pickup. */
export function jobsiteArea(order: Pick<StoreOrder, 'jobsite'>): string | null {
  const label = order.jobsite?.areaLabel?.trim();
  if (!label) return null;
  return label.split('·')[0]?.trim() || label;
}

/** "Delivery by 1:50 pm", "Delivery Tomorrow, 7–9 am", "Pickup ready by 2:15 pm". */
export function promiseLabel(
  order: Pick<StoreOrder, 'fulfilment' | 'window' | 'timing'>,
  now: number,
): string {
  if (order.fulfilment === 'pickup') {
    const day = formatDayET(order.timing.readyBy, now);
    const clock = formatClockET(order.timing.readyBy);
    return day === 'Today' ? `Pickup ready by ${clock}` : `Pickup ready ${day} by ${clock}`;
  }
  const window = order.window;
  if (window && window.kind === 'scheduled') return `Delivery ${windowLabel(window, now)}`;
  const deliverBy = order.timing.deliverBy ?? window?.endAt ?? null;
  if (deliverBy == null) return 'Delivery';
  const day = formatDayET(deliverBy, now);
  const clock = formatClockET(deliverBy);
  return day === 'Today' ? `Delivery by ${clock}` : `Delivery ${day} by ${clock}`;
}

const PHASE_TEXT: Record<DriverPhase, string> = {
  assigned: 'job accepted',
  to_store: 'heading to you',
  at_store: 'at the counter',
  loaded: 'loaded',
  to_site: 'on the way to the site',
  at_site: 'at the site',
  delivered: 'delivered',
  problem: 'needs help from dispatch',
};

export function driverPhaseText(phase: DriverPhase): string {
  return PHASE_TEXT[phase];
}

/** "Marco · F-150 · CBKX 214 · heading to you". */
export function driverChip(driver: NonNullable<StoreOrder['driver']>): string {
  return [driver.firstName, driver.vehicleLabel, driver.plate, PHASE_TEXT[driver.phase]]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ');
}

/** "182 kg · Pickup truck · 4×8 sheets". */
export function loadChip(order: Pick<StoreOrder, 'load' | 'vehicleClass' | 'fulfilment'>): string {
  const parts = [`${order.load.weightKg.toLocaleString('en-CA')} kg`];
  // A pickup leaves in the customer's own vehicle: the class only matters for a driver.
  if (order.vehicleClass && order.fulfilment === 'delivery')
    parts.push(VEHICLE_CLASSES[order.vehicleClass].label);
  if (order.load.hasSheets) parts.push('4×8 sheets');
  return parts.join(' · ');
}

export function statusLabel(status: StoreOrderStatus): string {
  return STORE_ORDER_META[status].label;
}

/** Reasons a store can give when it rejects or cancels (`no_response` is the system's own). */
export const REJECT_REASONS: readonly { id: Exclude<StoreRejectReason, 'no_response'>; label: string }[] = [
  { id: 'out_of_stock', label: 'Out of stock' },
  { id: 'cannot_meet_time', label: "Can't have it ready in time" },
  { id: 'store_closed', label: 'Store closed' },
  { id: 'pricing_error', label: 'Price is wrong in the catalogue' },
  { id: 'cannot_deliver_to_site', label: "The site can't take this load" },
  { id: 'other', label: 'Other reason' },
];

const REJECT_REASON_LABELS: Record<StoreRejectReason, string> = {
  out_of_stock: 'Out of stock',
  cannot_meet_time: "Couldn't have it ready in time",
  store_closed: 'Store closed',
  pricing_error: 'Pricing error',
  cannot_deliver_to_site: "Site couldn't take the load",
  no_response: 'Not accepted in time',
  other: 'Other reason',
};

export function rejectReasonLabel(reason: StoreRejectReason | null | undefined): string | null {
  return reason ? REJECT_REASON_LABELS[reason] : null;
}

export const SHORT_REASONS: readonly { id: ShortReason; label: string }[] = [
  { id: 'out_of_stock', label: 'Out of stock' },
  { id: 'damaged', label: 'Damaged' },
  { id: 'discontinued', label: 'Discontinued' },
  { id: 'other', label: 'Other' },
];

export function shortReasonLabel(reason: ShortReason | null | undefined): string | null {
  return SHORT_REASONS.find((item) => item.id === reason)?.label ?? null;
}

/** The lanes of the board, in order (MARKETPLACE §8). */
export type BoardLane = 'new' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'upcoming';

export const BOARD_LANES: readonly { id: BoardLane; title: string; empty: string }[] = [
  { id: 'new', title: 'New', empty: 'No orders waiting for you.' },
  { id: 'accepted', title: 'Accepted', empty: 'Nothing accepted yet.' },
  { id: 'preparing', title: 'Preparing', empty: 'Nothing being picked.' },
  { id: 'ready', title: 'Ready', empty: 'Nothing waiting at the counter.' },
  { id: 'out_for_delivery', title: 'Out for delivery', empty: 'No loads on the road.' },
  { id: 'done', title: 'Done today', empty: 'Nothing finished yet today.' },
  { id: 'upcoming', title: 'Upcoming', empty: 'No orders for later days.' },
];

/**
 * Which lane a board order belongs to. An accepted order that is due on a later Toronto day waits in
 * Upcoming; a failed delivery stays in "Out for delivery" until ops resolve it (`STORE_ORDER_META`).
 */
export function laneOf(order: Pick<StoreOrder, 'status' | 'timing'>, today: string): BoardLane {
  const column = STORE_ORDER_META[order.status].column;
  if (order.status === 'accepted' && order.timing.readyByDate > today) return 'upcoming';
  return column;
}

/** Toronto date of an instant, for comparing with `timing.readyByDate`. */
export const torontoDate = localDateOf;
