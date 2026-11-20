/**
 * The choices made on the checkout screens (window, jobsite, card, receiving, instructions). They are
 * shared by `checkout/index` and the three picker screens, live only in memory and are reset after an
 * order is placed, and whenever the signed-in account changes or signs out (`claimCheckoutDraft`): a
 * shared site tablet never shows one customer's gate code or receiving choice to the next. The cart
 * itself (lines, fulfilment, promo, labourer) stays in `CartProvider`.
 */
import type { Receiving, WindowOption } from '@instasupply/shared';
import { useSyncExternalStore } from 'react';

export interface CheckoutDraft {
  /** `asap` or a slot id; null: ASAP when it is available, else the first slot. */
  windowId: string | null;
  /** Null: the current site's jobsite, else the default jobsite. */
  jobsiteId: string | null;
  /** Null: the default card. */
  cardId: string | null;
  /** Null: the jobsite's default. */
  receiving: Receiving | null;
  /** Null: the jobsite's instructions. */
  instructions: string | null;
  /**
   * Fresh windows from a `WINDOW_UNAVAILABLE` answer; the picker shows these instead of its own while
   * `serverWindowsKey` still matches the checkout (same stores, jobsite, receiving) and they are recent.
   */
  serverWindows: WindowOption[] | null;
  /** The `Checkout.windowsKey` the server windows were answered for. */
  serverWindowsKey: string | null;
  /** When they arrived (epoch ms). */
  serverWindowsAt: number | null;
  /** Why the last card was refused (`CARD_DECLINED`), shown on the card picker. */
  declinedCardId: string | null;
}

const INITIAL: CheckoutDraft = {
  windowId: null,
  jobsiteId: null,
  cardId: null,
  receiving: null,
  instructions: null,
  serverWindows: null,
  serverWindowsKey: null,
  serverWindowsAt: null,
  declinedCardId: null,
};

/** How long the windows of a `WINDOW_UNAVAILABLE` answer stand in for the computed ones. */
export const SERVER_WINDOWS_TTL_MS = 2 * 60_000;

/** The inputs delivery windows depend on, as one comparable string. */
export function windowsKeyOf(storeIds: readonly string[], jobsiteId: string | null, receiving: Receiving) {
  return JSON.stringify([[...storeIds].sort(), jobsiteId, receiving]);
}

/** The server's windows while they still describe this checkout, else null (compute them locally). */
export function usableServerWindows(
  saved: Pick<CheckoutDraft, 'serverWindows' | 'serverWindowsKey' | 'serverWindowsAt'>,
  windowsKey: string,
  now: number,
): WindowOption[] | null {
  if (!saved.serverWindows || saved.serverWindowsKey !== windowsKey || saved.serverWindowsAt == null)
    return null;
  return now - saved.serverWindowsAt < SERVER_WINDOWS_TTL_MS ? saved.serverWindows : null;
}

let draft: CheckoutDraft = INITIAL;
/** The uid the draft belongs to; null for a guest or before the session is known. */
let ownerUid: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function updateCheckoutDraft(patch: Partial<CheckoutDraft>) {
  draft = { ...draft, ...patch };
  emit();
}

export function resetCheckoutDraft() {
  if (draft === INITIAL) return;
  draft = INITIAL;
  emit();
}

/**
 * Hands the draft to the session's account: a different uid (another account, or null after sign-out
 * or an ended session) starts from an empty draft. Called by `SessionProvider` on every uid change.
 */
export function claimCheckoutDraft(uid: string | null) {
  if (uid === ownerUid) return;
  ownerUid = uid;
  resetCheckoutDraft();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current draft, outside React (tests, event handlers). */
export const currentCheckoutDraft = (): CheckoutDraft => draft;
const snapshot = currentCheckoutDraft;

export function useCheckoutDraft(): CheckoutDraft {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
