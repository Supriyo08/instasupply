/**
 * Plays a seeded driver over the HTTP API (MARKETPLACE §11.5, last paragraph; docs/PLATFORM.md §2.2
 * `simulate`), so live tracking can be watched in the console's live map and on the customer tracking
 * page without a phone. Development only; it is a port of legacy/scripts/simulate-driver.ts.
 *
 *   npm run simulate -- --driver marco@instasupply.test --speed 60
 *
 * The driver signs in, goes online, plans their route and works the first stop again and again: drive to
 * the store, `checkInAtStore`, wait for `ready`, hand over (with `--auto-handover`, on by default, it signs
 * in as the store's owner and calls `completePickup` with the driver's PIN), drive to the site, `arrived`,
 * upload a placeholder proof photo and `completeDelivery` with the hand-off code (read by a staff account
 * from GET /deliveries/{id}/private).
 *
 * Options:
 *   --driver <email>      driver account (default marco@instasupply.test)
 *   --password <p>        password of the demo accounts (default: SEED_PASSWORD, else Instasupply@123)
 *   --api <origin>        the API origin (default: API_URL, else http://localhost:PORT, PORT 4000)
 *   --speed <km/h>        simulated speed (default 45; raise it to make demos faster)
 *   --interval <s>        seconds between location reports (default 2; the server accepts one per 2 s)
 *   --staff <email>       staff account that reads hand-off codes (default dispatch@instasupply.test)
 *   --store-email <e>     the store account for hand-overs (default: the owner, <first word of id>@instasupply.test)
 *   --no-auto-handover    wait for the store to hand over in the portal instead
 *   --start <lat,lng>     start here when the driver has no position yet (default Toronto 43.6532,-79.3832)
 *   --keep-running        wait for new work when the route is done instead of exiting
 */
import { randomUUID } from 'node:crypto';
import {
  bearingDegrees,
  haversineMeters,
  moveTowards,
  type ApiErrorBody,
  type AuthSessionResponse,
  type Delivery,
  type DeliveryPrivateMeta,
  type DriverLocation,
  type LatLng,
  type LocationReport,
  type PresignedUpload,
  type RoutePlan,
  type RouteStop,
  type StoreOrder,
  type UploadedFile,
} from '@instasupply/shared';

const DEFAULT_PASSWORD = 'Instasupply@123';
const TORONTO: LatLng = { lat: 43.6532, lng: -79.3832 };
const ARRIVAL_RADIUS_M = 30;
/** A 1×1 PNG: the server checks the magic number of every confirmed upload. */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ---------- options ----------

const argv = process.argv.slice(2);
function option(name: string): string | null {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : null;
}
const flag = (name: string): boolean => argv.includes(`--${name}`);

function positiveNumber(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function startOption(): LatLng {
  const raw = option('start');
  if (raw === null) return TORONTO;
  const [lat, lng] = raw.split(',').map(Number);
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('--start must be "lat,lng", for example 43.6532,-79.3832');
  }
  return { lat, lng };
}

const settings = {
  driver: (option('driver') ?? 'marco@instasupply.test').toLowerCase(),
  password: option('password') ?? (process.env.SEED_PASSWORD || DEFAULT_PASSWORD),
  api: (option('api') ?? process.env.API_URL ?? `http://localhost:${process.env.PORT ?? '4000'}`).replace(
    /\/+$/,
    '',
  ),
  speedKmh: positiveNumber('speed', 45),
  intervalMs: Math.max(2_100, positiveNumber('interval', 2) * 1000),
  staff: (option('staff') ?? 'dispatch@instasupply.test').toLowerCase(),
  storeEmail: option('store-email')?.toLowerCase() ?? null,
  autoHandover: !flag('no-auto-handover'),
  start: startOption(),
  keepRunning: flag('keep-running'),
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const log = (line: string) => console.log(line);

// ---------- HTTP ----------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
    what: string,
  ) {
    super(`${what}: ${status} ${body?.error.message ?? ''}`.trim());
  }

  get code(): string | null {
    return this.body?.error.code ?? null;
  }

  get retryAfterMs(): number | null {
    const value = this.body?.error.details.retryAfterMs;
    return typeof value === 'number' ? value : null;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

async function http<T>(method: string, path: string, body: unknown, token: string | null): Promise<T> {
  const response = await fetch(`${settings.api}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok)
    throw new HttpError(response.status, isErrorBody(parsed) ? parsed : null, `${method} ${path}`);
  return parsed as T;
}

/** A signed-in account: refreshes its access token, and signs in again when the refresh fails. */
class Session {
  private tokens: AuthSessionResponse | null = null;
  private expiresAt = 0;
  readonly installationId = `simulator-${randomUUID()}`;

  constructor(
    readonly email: string,
    private readonly app: 'driver' | 'console',
  ) {}

  get uid(): string {
    const uid = this.tokens?.me?.account.uid;
    if (!uid) throw new Error(`${this.email} is not signed in`);
    return uid;
  }

  async signIn(): Promise<void> {
    this.tokens = await http<AuthSessionResponse>(
      'POST',
      '/auth/login',
      { email: this.email, password: settings.password, installationId: this.installationId, app: this.app },
      null,
    );
    this.expiresAt = Date.now() + this.tokens.accessTokenTtlSeconds * 1000;
  }

  private async token(): Promise<string> {
    if (!this.tokens) await this.signIn();
    if (Date.now() > this.expiresAt - 60_000) {
      try {
        const refreshed = await http<AuthSessionResponse>(
          'POST',
          '/auth/refresh',
          { refreshToken: this.tokens!.refreshToken },
          null,
        );
        this.tokens = { ...refreshed, me: refreshed.me ?? this.tokens!.me };
        this.expiresAt = Date.now() + refreshed.accessTokenTtlSeconds * 1000;
      } catch {
        await this.signIn();
      }
    }
    return this.tokens!.accessToken;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await http<T>(method, path, body, await this.token());
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      await this.signIn();
      return http<T>(method, path, body, await this.token());
    }
  }

  call<T>(name: string, body: unknown): Promise<T> {
    return this.request<T>('POST', `/call/${name}`, body);
  }
}

// ---------- the driver ----------

const driver = new Session(settings.driver, 'driver');
const staffSessions = new Map<string, Session>();
let position: LatLng = settings.start;
let lastReportAt = 0;

function sessionFor(email: string): Session {
  let session = staffSessions.get(email);
  if (!session) {
    session = new Session(email, 'console');
    staffSessions.set(email, session);
  }
  return session;
}

/** POST /me/location, at most one report per interval; waits out RATE_LIMITED. */
async function report(online: boolean, heading: number | null, speed: number | null): Promise<void> {
  const wait = lastReportAt + settings.intervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  const body: LocationReport = {
    online,
    mode: 'live',
    battery: 0.76,
    fixes: [{ lat: position.lat, lng: position.lng, heading, speed, accuracy: 5, at: Date.now() }],
  };
  try {
    await driver.request('POST', '/me/location', body);
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== 'RATE_LIMITED') throw error;
    await sleep(error.retryAfterMs ?? 2_000);
    await driver.request('POST', '/me/location', body);
  }
  lastReportAt = Date.now();
}

async function optimize(): Promise<void> {
  try {
    await driver.call('optimizeRoute', { origin: position });
  } catch (error) {
    // At most one plan per 15 s per driver: the plan of a moment ago is good enough.
    if (!(error instanceof HttpError) || error.status !== 429) throw error;
  }
}

async function currentStop(): Promise<RouteStop | null> {
  try {
    const plan = await driver.request<RoutePlan>('GET', `/routes/${driver.uid}`);
    return plan.stops[0] ?? null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

const delivery = (id: string) => driver.request<Delivery>('GET', `/deliveries/${id}`);

/** Drives in a straight line until within the arrival radius, reporting every interval. */
async function driveTo(target: LatLng, label: string): Promise<void> {
  const stepMeters = (settings.speedKmh * 1000 * settings.intervalMs) / 3_600_000;
  // The server accepts up to 200 m/s; a demo may simulate faster than that.
  const speed = Math.min(200, (settings.speedKmh * 1000) / 3600);
  for (;;) {
    const distance = haversineMeters(position, target);
    if (distance <= ARRIVAL_RADIUS_M) break;
    const heading = bearingDegrees(position, target);
    position = moveTowards(position, target, Math.min(stepMeters, distance));
    await report(true, heading, speed);
    process.stdout.write(`\r  → ${label}: ${Math.round(haversineMeters(position, target))} m left      `);
  }
  process.stdout.write('\n');
  await report(true, null, 0);
}

function storeAccountFor(storeId: string): string {
  return settings.storeEmail ?? `${storeId.split('-')[0]}@instasupply.test`;
}

/** Works a pickup stop; false when the plan was stale (the load is already collected). */
async function pickup(stop: RouteStop): Promise<boolean> {
  let job = await delivery(stop.deliveryId);
  if (job.status !== 'assigned' && job.status !== 'accepted') return false;
  const pickupPoint = job.pickup;
  if (!pickupPoint || !job.storeOrderId) throw new Error(`${stop.orderId} has no store pickup`);
  if (job.status === 'assigned') {
    await driver.call('updateDeliveryStatus', { deliveryId: job.id, status: 'accepted', location: position });
    log(`  ${stop.orderId}: accepted`);
  }
  await driveTo(pickupPoint.location, `${pickupPoint.storeName} (pickup ${stop.orderId})`);
  await driver.call('checkInAtStore', { deliveryId: job.id, location: position });
  log(`  ${stop.orderId}: checked in at ${pickupPoint.storeName}`);

  for (;;) {
    job = await delivery(job.id);
    if (job.status !== 'accepted') break;
    if (job.pickup?.ready && settings.autoHandover) {
      const store = sessionFor(storeAccountFor(job.pickup.storeId));
      const storeOrder = await store.request<StoreOrder>('GET', `/store-orders/${job.storeOrderId}`);
      await store.call('completePickup', {
        storeOrderId: storeOrder.id,
        expectedVersion: storeOrder.version,
        pickupCode: job.pickup.pickupCode,
      });
      log(`  ${stop.orderId}: handed over by ${store.email} with the PIN`);
      continue;
    }
    process.stdout.write(
      `\r  ${stop.orderId}: waiting for the store (${job.pickup?.ready ? 'ready' : 'preparing'})   `,
    );
    await report(true, null, 0);
  }
  process.stdout.write('\n');
  log(`  ${stop.orderId}: ${job.status}`);
  return true;
}

async function uploadProof(deliveryId: string): Promise<string> {
  const ticket = await driver.request<PresignedUpload>('POST', '/files/presign', {
    purpose: 'proof',
    ownerId: deliveryId,
    fileName: 'drop-off.png',
    contentType: 'image/png',
    sizeBytes: PLACEHOLDER_PNG.length,
  });
  const url = ticket.url.startsWith('http') ? ticket.url : `${settings.api}${ticket.url}`;
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
  form.append('file', new Blob([PLACEHOLDER_PNG], { type: 'image/png' }), 'drop-off.png');
  const response = await fetch(url, { method: ticket.method, body: form, headers: ticket.headers });
  if (!response.ok) throw new Error(`proof upload failed: ${response.status} ${await response.text()}`);
  const file = await driver.request<UploadedFile>('POST', '/files/confirm', { uploadId: ticket.uploadId });
  return file.path;
}

/** Works a drop-off stop; false when the plan was stale (the delivery is already over). */
async function dropoff(stop: RouteStop): Promise<boolean> {
  let job = await delivery(stop.deliveryId);
  if (job.status === 'delivered' || job.status === 'failed' || job.status === 'cancelled') return false;
  if (job.status === 'assigned') {
    await driver.call('updateDeliveryStatus', { deliveryId: job.id, status: 'accepted', location: position });
    job = await delivery(job.id);
  }
  if (job.status === 'accepted' && job.kind === 'manual') {
    await driver.call('updateDeliveryStatus', {
      deliveryId: job.id,
      status: 'picked_up',
      location: position,
    });
    job = await delivery(job.id);
  }
  if (job.status === 'picked_up') {
    await driver.call('updateDeliveryStatus', {
      deliveryId: job.id,
      status: 'in_transit',
      location: position,
    });
    log(`  ${stop.orderId}: on the way`);
  }
  await driveTo(job.location, `${stop.orderId} ${stop.title}`);
  job = await delivery(job.id);
  if (job.status === 'in_transit') {
    await driver.call('updateDeliveryStatus', { deliveryId: job.id, status: 'arrived', location: position });
    log(`  ${stop.orderId}: arrived`);
    await sleep(2_000);
  }
  const photoPath = job.requirePhoto ? await uploadProof(job.id) : null;
  let handoffCode: string | null = null;
  if (job.requireCode) {
    const meta = await sessionFor(settings.staff).request<DeliveryPrivateMeta>(
      'GET',
      `/deliveries/${job.id}/private`,
    );
    handoffCode = meta.handoffCode;
  }
  await driver.call('completeDelivery', {
    deliveryId: job.id,
    recipientName: job.customer.name,
    handoffCode,
    photoPath,
    location: position,
  });
  log(`  ${stop.orderId}: delivered`);
  return true;
}

async function main(): Promise<void> {
  await driver.signIn();
  try {
    const known = await driver.request<DriverLocation>('GET', `/driver-locations/${driver.uid}`);
    position = { lat: known.lat, lng: known.lng };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
  }
  log(
    `Simulating ${settings.driver} against ${settings.api} at ${settings.speedKmh} km/h from ` +
      `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)} (a report every ${settings.intervalMs / 1000} s).`,
  );
  await report(true, null, 0);
  await optimize();

  for (;;) {
    const stop = await currentStop();
    if (!stop) {
      if (!settings.keepRunning) {
        log('Route complete. The driver stays online; done.');
        return;
      }
      await report(true, null, 0);
      await sleep(15_000);
      await optimize();
      continue;
    }
    log(`Next stop: ${stop.kind} ${stop.orderId} · ${stop.title} · ${stop.address}`);
    const worked = stop.kind === 'pickup' ? await pickup(stop) : await dropoff(stop);
    // A stale plan (the route was planned less than 15 s ago): wait until a new one may be asked for.
    await sleep(worked ? 1_500 : 15_000);
    await optimize();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
