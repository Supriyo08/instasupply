/**
 * Every SQL statement of the deliveries module on `deliveries`, `delivery_events` and the creation of the
 * `tracking` row (docs/PLATFORM.md §2.1, §3.3). Rows are mapped to the shared `Delivery` here and nowhere
 * else; `meta` (tracking token, hand-off code, code attempts, tracking-link marker) has its own functions.
 */
import type {
  ActorRole,
  Delivery,
  DeliveryEvent,
  DeliveryEventType,
  DeliveryPrivateMeta,
  DeliveryStatus,
  LatLng,
  PublicTracking,
} from '@instasupply/shared';
import type { DeliveryRow, LockedGraph } from '../../platform/db/locks';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable;

/** The stored document: the shared Delivery without its key and instants (§3.1 rule 3). */
export type DeliveryDoc = Omit<Delivery, 'id' | 'createdAt' | 'updatedAt'>;

/** `deliveries.meta`: DeliveryPrivateMeta plus the two server-only markers (§3.3). */
export interface DeliveryMeta extends DeliveryPrivateMeta {
  codeAttempts: number;
  trackingLinkSentAt: number | null;
}

interface PublicRow {
  id: string;
  doc: DeliveryDoc;
  created_at: number;
  updated_at: number;
}

const COLUMNS = 'id, doc, created_at, updated_at';

export const toDelivery = (row: Pick<PublicRow, 'id' | 'doc' | 'created_at' | 'updated_at'>): Delivery => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** A locked row of the graph as the shared document. */
export function deliveryOf(graph: LockedGraph, id: string): Delivery | null {
  const row = graph.deliveries.get(id);
  return row ? toDelivery(row as unknown as PublicRow) : null;
}

export function metaOf(row: DeliveryRow): DeliveryMeta {
  const meta = row.meta as Partial<DeliveryMeta>;
  return {
    trackingToken: String(meta.trackingToken ?? ''),
    handoffCode: String(meta.handoffCode ?? ''),
    codeAttempts: typeof meta.codeAttempts === 'number' ? meta.codeAttempts : 0,
    trackingLinkSentAt: typeof meta.trackingLinkSentAt === 'number' ? meta.trackingLinkSentAt : null,
  };
}

export async function findDelivery(db: Db, id: string): Promise<Delivery | null> {
  const { rows } = await db.query<PublicRow>(`SELECT ${COLUMNS} FROM deliveries WHERE id = $1`, [id]);
  return rows[0] ? toDelivery(rows[0]) : null;
}

export interface DeliveryKeys {
  id: string;
  status: DeliveryStatus;
  kind: 'marketplace' | 'manual';
  driver_id: string | null;
  customer_id: string | null;
  store_order_id: string | null;
  source_order_id: string | null;
}

/** The keys a flow needs before it locks (§3.6 rule 3). */
export async function findDeliveryKeys(db: Db, id: string): Promise<DeliveryKeys | null> {
  const { rows } = await db.query<DeliveryKeys>(
    `SELECT id, status, kind, driver_id, customer_id, store_order_id, source_order_id FROM deliveries WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findDeliveryIdByStoreOrder(db: Db, storeOrderId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM deliveries WHERE store_order_id = $1', [
    storeOrderId,
  ]);
  return rows[0]?.id ?? null;
}

export async function findMeta(db: Db, id: string): Promise<DeliveryMeta | null> {
  const { rows } = await db.query<{ meta: Partial<DeliveryMeta> }>(
    'SELECT meta FROM deliveries WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return metaOf({ meta: row.meta } as DeliveryRow);
}

export async function insertDelivery(tx: Tx, delivery: Delivery, meta: DeliveryMeta): Promise<void> {
  const { id, createdAt, updatedAt, ...doc } = delivery;
  await tx.query(
    `INSERT INTO deliveries (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
    [id, JSON.stringify(doc), JSON.stringify(meta), new Date(createdAt), new Date(updatedAt)],
  );
  await publishChange(tx, 'deliveries', 'created', delivery);
}

/**
 * Replaces the document of a locked delivery (§3.6) and stamps `updated_at = tx.now`. Keeps the graph's
 * copy current, so later helpers of the same transaction read what was written.
 */
export async function saveDelivery(tx: Tx, graph: LockedGraph | null, delivery: Delivery): Promise<Delivery> {
  const { id, createdAt: _c, updatedAt: _u, ...doc } = delivery;
  const previous = graph?.deliveries.get(id);
  await tx.query('UPDATE deliveries SET doc = $2::jsonb, updated_at = $3 WHERE id = $1', [
    id,
    JSON.stringify(doc),
    new Date(tx.now),
  ]);
  const saved: Delivery = { ...delivery, updatedAt: tx.now };
  if (graph && previous) {
    graph.deliveries.set(id, {
      ...previous,
      doc: doc as unknown as Record<string, unknown>,
      status: saved.status,
      driver_id: saved.driverId,
      updated_at: tx.now,
    });
  }
  const previousDriverId = previous ? (previous.driver_id ?? null) : null;
  await publishChange(tx, 'deliveries', 'updated', { ...saved, previousDriverId });
  return saved;
}

/** Merges keys into `meta` of a locked delivery. */
export async function patchMeta(tx: Tx, id: string, patch: Partial<DeliveryMeta>): Promise<void> {
  await tx.query('UPDATE deliveries SET meta = meta || $2::jsonb WHERE id = $1', [id, JSON.stringify(patch)]);
}

// ---------- events ----------

/** Who caused an event; `system` only for schedules and cascades (MARKETPLACE §2.3). */
export interface EventActorShape {
  id: string | null;
  name: string | null;
  role: ActorRole;
}

export interface EventInput {
  type: DeliveryEventType;
  message: string;
  status?: DeliveryStatus | null;
  fromStatus?: DeliveryStatus | null;
  location?: LatLng | null;
}

type EventDoc = Omit<DeliveryEvent, 'id' | 'deliveryId' | 'at'>;

interface EventRow {
  id: number;
  delivery_id: string;
  at: number;
  doc: EventDoc;
}

const toEvent = (row: EventRow): DeliveryEvent => ({
  ...row.doc,
  id: String(row.id),
  deliveryId: row.delivery_id,
  at: row.at,
});

/** Appends an audit event in the transaction of the change it describes. */
export async function insertEvent(
  tx: Tx,
  delivery: Pick<Delivery, 'id' | 'orderId' | 'driverId'>,
  actor: EventActorShape,
  input: EventInput,
): Promise<void> {
  const doc: EventDoc = {
    orderId: delivery.orderId,
    driverId: delivery.driverId ?? null,
    type: input.type,
    status: input.status ?? null,
    fromStatus: input.fromStatus ?? null,
    message: input.message,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    location: input.location ?? null,
  };
  await tx.query(`INSERT INTO delivery_events (delivery_id, at, doc) VALUES ($1, $2, $3::jsonb)`, [
    delivery.id,
    new Date(tx.now),
    JSON.stringify(doc),
  ]);
  await publishChange(tx, 'delivery_events', 'created', { deliveryId: delivery.id });
}

export async function listEvents(
  db: Db,
  input: { deliveryId: string | null; limit: number; beforeId: number | null },
): Promise<DeliveryEvent[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  if (input.deliveryId !== null) {
    values.push(input.deliveryId);
    where.push(`delivery_id = $${values.length}`);
  }
  if (input.beforeId !== null) {
    values.push(input.beforeId);
    where.push(`id < $${values.length}`);
  }
  values.push(input.limit + 1);
  const { rows } = await db.query<EventRow>(
    `SELECT id, delivery_id, at, doc FROM delivery_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map(toEvent);
}

// ---------- tracking (the row is created with the delivery; routing owns its later fields, §9.4) ----------

export async function insertTracking(
  tx: Tx,
  token: string,
  doc: Omit<PublicTracking, 'updatedAt'>,
): Promise<void> {
  await tx.query(
    `INSERT INTO tracking (token, delivery_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, $4)`,
    [token, doc.deliveryId, JSON.stringify(doc), new Date(tx.now)],
  );
  await publishChange(tx, 'tracking', 'created', { token, ...doc, updatedAt: tx.now });
}

// ---------- driver-side reads ----------

/** Active deliveries of a driver (stable while the driver's row is locked, §3.6 rule 2). */
export async function countActiveDeliveries(db: Db, driverId: string, statuses: readonly DeliveryStatus[]) {
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM deliveries WHERE driver_id = $1 AND status = ANY($2::text[])',
    [driverId, [...statuses]],
  );
  return rows[0]?.n ?? 0;
}

/** The driver's trips that are "on the way" or at the site (the ones a new trip parks). */
export async function movingDeliveryIds(db: Db, driverId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM deliveries WHERE driver_id = $1 AND status IN ('in_transit', 'arrived') ORDER BY id COLLATE "C"`,
    [driverId],
  );
  return rows.map((row) => row.id);
}

/** Uncollected marketplace deliveries and collected open ones of a driver (the suspension release, §9.2.9). */
export async function openDeliveriesOfDriver(db: Db, driverId: string): Promise<Delivery[]> {
  const { rows } = await db.query<PublicRow>(
    `SELECT ${COLUMNS} FROM deliveries
      WHERE driver_id = $1 AND status IN ('assigned', 'accepted', 'picked_up', 'in_transit', 'arrived')
      ORDER BY id COLLATE "C"`,
    [driverId],
  );
  return rows.map(toDelivery);
}

// ---------- lists ----------

export interface DeliveryListQuery {
  driverId?: string;
  status?: DeliveryStatus[];
  kind?: 'marketplace' | 'manual';
  storeId?: string;
  unloadStatus?: string;
  offerStatus?: string[];
  createdSince?: number;
  updatedSince?: number;
  deliveredSince?: number;
  sort: 'createdAt:desc' | 'updatedAt:desc';
  limit: number;
  cursor: [number, string] | null;
}

export async function listDeliveries(db: Db, query: DeliveryListQuery): Promise<PublicRow[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replaceAll('?', `$${values.length}`));
  };
  if (query.driverId !== undefined) add('driver_id = ?', query.driverId);
  if (query.status?.length) add('status = ANY(?::text[])', query.status);
  if (query.kind) add('kind = ?', query.kind);
  if (query.storeId) add('store_id = ?', query.storeId);
  if (query.unloadStatus) add('unload_status = ?', query.unloadStatus);
  if (query.offerStatus?.length) add('offer_status = ANY(?::text[])', query.offerStatus);
  if (query.createdSince !== undefined) add('created_at >= ?', new Date(query.createdSince));
  if (query.updatedSince !== undefined) add('updated_at >= ?', new Date(query.updatedSince));
  if (query.deliveredSince !== undefined) add('delivered_at >= ?', new Date(query.deliveredSince));
  const column = query.sort === 'updatedAt:desc' ? 'updated_at' : 'created_at';
  if (query.cursor) {
    values.push(new Date(query.cursor[0]), query.cursor[1]);
    where.push(`(${column}, id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(query.limit + 1);
  const { rows } = await db.query<PublicRow>(
    `SELECT ${COLUMNS} FROM deliveries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${column} DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

/**
 * Deliveries of a driver that became delivered or failed since `since` (DeliveryStats). A failure has no
 * mirror column, so it is read from the document's `failedAt`.
 */
export async function deliveryStats(db: Db, driverId: string, since: number) {
  const { rows } = await db.query<{ delivered: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'delivered' AND delivered_at >= $2)::int AS delivered,
            count(*) FILTER (WHERE status = 'failed' AND (doc->>'failedAt')::bigint >= $3)::int AS failed
       FROM deliveries WHERE driver_id = $1 AND status IN ('delivered', 'failed')`,
    [driverId, new Date(since), since],
  );
  return rows[0] ?? { delivered: 0, failed: 0 };
}
