/**
 * The store profile form (MARKETPLACE §8 `/portal/store`, reused by ops on `/stores/:storeId`): text
 * drafts in, a `StoreProfilePatch` of only the fields that changed out (an edit never re-sends what
 * someone else may have corrected meanwhile), checked with `validateStoreProfile` from shared, the same
 * function the server runs.
 */
import {
  WEEKDAYS,
  validateStoreProfile,
  type DayHours,
  type Store,
  type StorePrivateSettings,
  type StoreProfilePatch,
  type Weekday,
} from '@instasupply/shared';

export interface DayDraft {
  closed: boolean;
  open: string;
  close: string;
}

export interface ProfileDraft {
  description: string;
  phone: string;
  email: string;
  hours: Record<Weekday, DayDraft>;
  closures: string[];
  prepMinutes: string;
  sameDayCutoff: string;
  delivery: boolean;
  pickup: boolean;
  /** Private settings: only owners and staff read and write them. */
  loadingNotes: string;
  alertPhone: string;
}

export type ProfileField = keyof StoreProfilePatch | 'form';
export type ProfileErrors = Partial<Record<ProfileField, string>>;

const DEFAULT_OPEN = '07:00';
const DEFAULT_CLOSE = '17:00';

function dayDraft(hours: DayHours | null): DayDraft {
  return hours
    ? { closed: false, open: hours.open, close: hours.close }
    : { closed: true, open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
}

function hoursOf(draft: ProfileDraft['hours']): Record<Weekday, DayHours | null> {
  return Object.fromEntries(
    WEEKDAYS.map((day) => {
      const value = draft[day];
      return [day, value.closed ? null : { open: value.open, close: value.close }];
    }),
  ) as Record<Weekday, DayHours | null>;
}

/** The form's starting values. Closure dates before `today` are dropped: the server refuses them. */
export function draftFrom(store: Store, settings: StorePrivateSettings | null, today: string): ProfileDraft {
  return {
    description: store.description,
    phone: store.phone,
    email: store.email ?? '',
    hours: Object.fromEntries(WEEKDAYS.map((day) => [day, dayDraft(store.hours[day])])) as Record<
      Weekday,
      DayDraft
    >,
    closures: store.closures.filter((date) => date >= today).sort(),
    prepMinutes: String(store.prepMinutes),
    sameDayCutoff: store.sameDayCutoff,
    delivery: store.fulfilment.delivery,
    pickup: store.fulfilment.pickup,
    loadingNotes: settings?.loadingNotes ?? '',
    alertPhone: settings?.alertPhone ?? '',
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The raw change request: only fields that differ from `base`. Private fields are included only when
 * `withPrivate` (the caller can read the settings), so a staff member's save never blanks them.
 */
function rawPatch(draft: ProfileDraft, base: ProfileDraft, withPrivate: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.description.trim() !== base.description.trim()) patch.description = draft.description.trim();
  if (draft.phone.trim() !== base.phone.trim()) patch.phone = draft.phone.trim();
  if (draft.email.trim() !== base.email.trim()) patch.email = draft.email.trim() || null;
  if (!sameJson(hoursOf(draft.hours), hoursOf(base.hours))) patch.hours = hoursOf(draft.hours);
  if (!sameJson([...draft.closures].sort(), [...base.closures].sort()))
    patch.closures = [...draft.closures].sort();
  if (draft.prepMinutes.trim() !== base.prepMinutes.trim()) patch.prepMinutes = draft.prepMinutes.trim();
  if (draft.sameDayCutoff !== base.sameDayCutoff) patch.sameDayCutoff = draft.sameDayCutoff;
  const fulfilment: { delivery?: boolean; pickup?: boolean } = {};
  if (draft.delivery !== base.delivery) fulfilment.delivery = draft.delivery;
  if (draft.pickup !== base.pickup) fulfilment.pickup = draft.pickup;
  if (Object.keys(fulfilment).length > 0) patch.fulfilment = fulfilment;
  if (withPrivate) {
    if (draft.loadingNotes.trim() !== base.loadingNotes.trim())
      patch.loadingNotes = draft.loadingNotes.trim() || null;
    if (draft.alertPhone.trim() !== base.alertPhone.trim())
      patch.alertPhone = draft.alertPhone.trim() || null;
  }
  return patch;
}

export type PatchResult =
  { ok: true; patch: StoreProfilePatch; changed: number } | { ok: false; errors: ProfileErrors };

/** Checks the changed fields as the server will; `prepMinutes` goes from text to a number here. */
export function buildPatch(
  draft: ProfileDraft,
  base: ProfileDraft,
  options: { withPrivate: boolean; today: string; storeId: string },
): PatchResult {
  const raw = rawPatch(draft, base, options.withPrivate);
  if (typeof raw.prepMinutes === 'string') {
    raw.prepMinutes = /^\d+$/.test(raw.prepMinutes) ? Number(raw.prepMinutes) : raw.prepMinutes;
  }
  if (!draft.delivery && !draft.pickup) {
    return {
      ok: false,
      errors: { fulfilment: 'Offer delivery, pickup or both. To stop orders, use “Pause new orders”.' },
    };
  }
  const result = validateStoreProfile(raw, options.today, options.storeId);
  if (!result.ok) return { ok: false, errors: result.errors as ProfileErrors };
  return { ok: true, patch: result.value, changed: Object.keys(raw).length };
}

export function isDirty(draft: ProfileDraft, base: ProfileDraft, withPrivate: boolean): boolean {
  return Object.keys(rawPatch(draft, base, withPrivate)).length > 0;
}
