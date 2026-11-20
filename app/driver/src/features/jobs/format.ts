/**
 * Display text shared by the job board, the offer screen and the delivery screens (MARKETPLACE §10).
 * Pure functions: every time is passed in as `now` (use `useNow()`), every amount stays in cents.
 */
import {
  VEHICLE_CLASSES,
  formatClockET,
  formatDayET,
  formatWindowET,
  toMillis,
  type JobOffer,
  type TimeInput,
  type VehicleClass,
} from '@instasupply/shared';

const CM_PER_FOOT = 30.48;

/** "8 ft" for 244 cm; lengths under a foot read "1 ft". */
export function feetText(cm: number): string {
  return `${Math.max(1, Math.round(cm / CM_PER_FOOT))} ft`;
}

/** "182 kg"; under 10 kg keeps one decimal ("4.5 kg"). */
export function weightText(kg: number): string {
  return kg < 10 ? `${Math.round(kg * 10) / 10} kg` : `${Math.round(kg)} kg`;
}

/** "26.0 km". */
export function kmText(km: number | null | undefined): string {
  return km == null || !Number.isFinite(km) ? '—' : `${km.toFixed(1)} km`;
}

/** The class name from the table of §3.3 ("Cargo van"); an unknown class is shown as it is stored. */
export function classLabel(vehicleClass: VehicleClass | string | null | undefined): string {
  if (!vehicleClass) return 'Any vehicle';
  return (
    (VEHICLE_CLASSES as Record<string, { label: string } | undefined>)[vehicleClass]?.label ?? vehicleClass
  );
}

interface LoadFacts {
  summary: string;
  weightKg: number;
  longestCm: number;
  hasSheets: boolean;
}

/** "20 × 2x4x8 SPF stud, 4 × OSB 7/16 in · 182 kg · longest 8 ft · sheets". */
export function loadText(load: LoadFacts): string {
  return [
    load.summary,
    weightText(load.weightKg),
    `longest ${feetText(load.longestCm)}`,
    ...(load.hasSheets ? ['sheets'] : []),
  ].join(' · ');
}

/** Who unloads at the site, as the board card says it. */
export function unloadText(unload: JobOffer['unload']): string {
  switch (unload) {
    case 'site_crew':
      return 'Site crew helps';
    case 'labourer':
      return 'Labourer meets you';
    case 'driver':
      return 'Unattended: photo drop';
  }
}

/** "Kestrel Lumber Yard · Etobicoke → Leslieville · M4M · 26.0 km". */
export function tripText(offer: Pick<JobOffer, 'pickup' | 'dropoff' | 'tripKm'>): string {
  return `${offer.pickup.storeName} · ${offer.pickup.areaLabel} → ${offer.dropoff.areaLabel} · ${kmText(offer.tripKm)}`;
}

/**
 * A scheduled window with its day ("Fri, Nov 20 7–9 am", "Today 7–9 am"), or an ASAP deadline
 * ("deliver by 1:50 pm"; another day adds it: "deliver by Tomorrow, 9:00 am").
 */
export function windowText(start: TimeInput, end: TimeInput, now: number): string {
  if (toMillis(start) != null) return `${formatDayET(start, now)} ${formatWindowET(start, end)}`;
  const day = formatDayET(end, now);
  return day === 'Today' ? `deliver by ${formatClockET(end)}` : `deliver by ${day}, ${formatClockET(end)}`;
}

/** The time line of a board card: "Ready 12:50 pm · deliver by 1:50 pm" or "Fri, Nov 20 7–9 am". */
export function offerTimeText(offer: Pick<JobOffer, 'pickup' | 'window'>, now: number): string {
  if (offer.window.kind === 'scheduled') return windowText(offer.window.startAt, offer.window.endAt, now);
  const readyAt = toMillis(offer.pickup.readyBy);
  const ready =
    offer.pickup.ready || (readyAt != null && readyAt <= now)
      ? 'Ready now'
      : `Ready ${formatClockET(readyAt)}`;
  return `${ready} · ${windowText(null, offer.window.endAt, now)}`;
}
