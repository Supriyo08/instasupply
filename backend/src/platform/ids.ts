import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A server-generated id: UUIDv4, lower case (the database checks client ids with the same pattern). */
export const newId = (): string => randomUUID();

/** Client-generated ids (checkoutId, requestId, jobsite ids, message ids) must be UUIDv4 (D17). */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID4.test(value);
}

/** The public tracking token: unguessable, URL-safe, short enough for an SMS. */
export const newTrackingToken = (): string => randomBytes(18).toString('base64url');

/** The driver hand-off code read out at the jobsite (MARKETPLACE §2.3): 4 digits. */
export const newHandoffCode = (): string => String(randomInt(0, 10_000)).padStart(4, '0');

/** The pickup PIN of a store order (MARKETPLACE §5.5.2): 4 digits. */
export const newPickupCode = (): string => String(randomInt(0, 10_000)).padStart(4, '0');
