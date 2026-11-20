/**
 * The vehicle a driver declares (MARKETPLACE §10, onboarding/vehicle and the Vehicle screen). The form
 * keeps what was typed as text; `checkVehicle` hands it to the shared `validateDriverVehicle`, which
 * the server runs too, so the app and `registerDriver` / `updateDriverVehicle` agree on every rule.
 */
import {
  capacityClassFor,
  localDateOf,
  validateDriverVehicle,
  VEHICLE_CLASSES,
  VEHICLE_EXTRA_LABELS,
  VEHICLE_TYPE_LABELS,
  type DriverVehicle,
  type DriverVehicleInput,
  type ValidationResult,
  type VehicleExtra,
  type VehicleType,
} from '@instasupply/shared';

export type BoxLength = DriverVehicleInput['boxLengthFt'];

export interface VehicleFormValue {
  type: VehicleType | null;
  make: string;
  model: string;
  year: string;
  plate: string;
  colour: string;
  boxLengthFt: BoxLength;
  payloadKg: string;
  extras: VehicleExtra[];
}

export type VehicleFormErrors = Partial<Record<keyof DriverVehicleInput | 'form', string>>;

/** A form filled from a saved vehicle or the onboarding draft; empty fields stay empty. */
export function vehicleFormFrom(vehicle: Partial<DriverVehicleInput> | null | undefined): VehicleFormValue {
  return {
    type: vehicle?.type ?? null,
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year ? String(vehicle.year) : '',
    plate: vehicle?.plate ?? '',
    colour: vehicle?.colour ?? '',
    boxLengthFt: vehicle?.boxLengthFt ?? null,
    payloadKg: vehicle?.payloadKg ? String(vehicle.payloadKg) : '',
    extras: vehicle?.extras ? [...vehicle.extras] : [],
  };
}

/** Only the fields the driver declares: a stored vehicle also carries `capacityClass`, set by ops. */
export function vehicleInputOf(vehicle: DriverVehicle): DriverVehicleInput {
  return {
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    plate: vehicle.plate,
    colour: vehicle.colour,
    boxLengthFt: vehicle.boxLengthFt,
    payloadKg: vehicle.payloadKg,
    extras: vehicle.extras,
  };
}

/** The shared rules, with "today" taken from the server-corrected clock (Toronto date). */
export function checkVehicle(value: VehicleFormValue, now: number): ValidationResult<DriverVehicleInput> {
  return validateDriverVehicle(
    {
      type: value.type,
      make: value.make,
      model: value.model,
      year: value.year.trim(),
      plate: value.plate,
      colour: value.colour,
      boxLengthFt: value.type === 'pickup' ? value.boxLengthFt : null,
      payloadKg: value.payloadKg.trim().replace(',', '.'),
      extras: value.extras,
    },
    localDateOf(now),
  );
}

/** What was typed so far, valid or not, for the onboarding draft (a step back must not lose it). */
export function draftVehicleOf(value: VehicleFormValue): Partial<DriverVehicleInput> {
  const year = Number(value.year);
  const payload = Number(value.payloadKg.trim().replace(',', '.'));
  return {
    ...(value.type ? { type: value.type } : {}),
    make: value.make.trim(),
    model: value.model.trim(),
    ...(Number.isInteger(year) && year > 0 ? { year } : {}),
    plate: value.plate.trim(),
    colour: value.colour.trim() || null,
    boxLengthFt: value.type === 'pickup' ? value.boxLengthFt : null,
    payloadKg: value.payloadKg.trim() && payload > 0 ? payload : null,
    extras: value.extras,
  };
}

/** True when the form says something different from the vehicle it started from. */
export function vehicleChanged(value: VehicleFormValue, from: DriverVehicleInput | null): boolean {
  const start = vehicleFormFrom(from);
  return (
    value.type !== start.type ||
    value.make.trim() !== start.make ||
    value.model.trim() !== start.model ||
    value.year.trim() !== start.year ||
    value.plate.trim().toUpperCase() !== start.plate ||
    value.colour.trim() !== start.colour ||
    (value.type === 'pickup' && value.boxLengthFt !== start.boxLengthFt) ||
    value.payloadKg.trim() !== start.payloadKg ||
    [...value.extras].sort().join() !== [...start.extras].sort().join()
  );
}

/** "Pickup truck class": what the declared vehicle would be rated as (staff may change it at review). */
export function expectedClassLabel(value: Pick<VehicleFormValue, 'type' | 'boxLengthFt'>): string | null {
  if (!value.type) return null;
  return VEHICLE_CLASSES[capacityClassFor({ type: value.type, boxLengthFt: value.boxLengthFt })].label;
}

/** "2021 Ford F-150 · white · CBKX 214". */
export function vehicleTitle(vehicle: Pick<DriverVehicleInput, 'year' | 'make' | 'model'>): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

/** "Pickup · 6.5 ft box · 700 kg payload · Trailer, Ramps/dolly". */
export function vehicleDetails(vehicle: DriverVehicleInput): string {
  const parts: string[] = [VEHICLE_TYPE_LABELS[vehicle.type]];
  if (vehicle.colour) parts.push(vehicle.colour);
  if (vehicle.type === 'pickup' && vehicle.boxLengthFt) parts.push(`${vehicle.boxLengthFt} ft box`);
  if (vehicle.payloadKg) parts.push(`${vehicle.payloadKg} kg payload`);
  if (vehicle.extras.length)
    parts.push(vehicle.extras.map((extra) => VEHICLE_EXTRA_LABELS[extra]).join(', '));
  return parts.join(' · ');
}
