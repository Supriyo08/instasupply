/**
 * Every SQL statement of the jobs module on `job_offers` (docs/PLATFORM.md §2.1, §3.3). The stored `doc` is
 * the JobOffer without `deliveryId`, `createdAt` and `updatedAt`; the API shape is `WithId<JobOffer>` with
 * `id = deliveryId`.
 */
import type { JobOffer, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable;

export type OfferDoc = Omit<JobOffer, 'deliveryId' | 'createdAt' | 'updatedAt'>;

export interface OfferRow {
  delivery_id: string;
  doc: OfferDoc;
  created_at: number;
  updated_at: number;
}

const COLUMNS = 'delivery_id, doc, created_at, updated_at';

export const toOffer = (row: OfferRow): WithId<JobOffer> => ({
  ...row.doc,
  id: row.delivery_id,
  deliveryId: row.delivery_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function findOffer(db: Db, deliveryId: string): Promise<WithId<JobOffer> | null> {
  const { rows } = await db.query<OfferRow>(`SELECT ${COLUMNS} FROM job_offers WHERE delivery_id = $1`, [
    deliveryId,
  ]);
  return rows[0] ? toOffer(rows[0]) : null;
}

/** Inserts or replaces the offer of a locked delivery; `created_at` survives a replacement. */
export async function upsertOffer(
  tx: Tx,
  offer: JobOffer,
  previousStatus: JobOffer['status'] | null,
): Promise<void> {
  const { deliveryId, createdAt, updatedAt: _u, ...doc } = offer;
  await tx.query(
    `INSERT INTO job_offers (delivery_id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (delivery_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
    [deliveryId, JSON.stringify(doc), new Date(createdAt), new Date(tx.now)],
  );
  await publishChange(tx, 'job_offers', previousStatus === null ? 'created' : 'updated', {
    deliveryId,
    audience: offer.audience,
    status: offer.status,
    previousStatus,
  });
}

/** Deletes the offer of a delivery, if there is one (the row is referenced by nothing). */
export async function removeOffer(tx: Tx, deliveryId: string): Promise<boolean> {
  const { rows } = await tx.query<OfferRow>(
    `DELETE FROM job_offers WHERE delivery_id = $1 RETURNING ${COLUMNS}`,
    [deliveryId],
  );
  const row = rows[0];
  if (!row) return false;
  await publishChange(tx, 'job_offers', 'deleted', {
    deliveryId,
    audience: row.doc.audience,
    status: row.doc.status,
    previousStatus: row.doc.status,
  });
  return true;
}

/** The offer row under the caller's lock, for an update. */
export async function lockOffer(tx: Tx, deliveryId: string): Promise<WithId<JobOffer> | null> {
  const { rows } = await tx.query<OfferRow>(
    `SELECT ${COLUMNS} FROM job_offers WHERE delivery_id = $1 FOR NO KEY UPDATE`,
    [deliveryId],
  );
  return rows[0] ? toOffer(rows[0]) : null;
}

/** Statement (i) of §3.5, first half: the board of one audience key. */
export async function listOpenOffersFor(db: Db, key: string, limit: number): Promise<WithId<JobOffer>[]> {
  const { rows } = await db.query<OfferRow>(
    `SELECT ${COLUMNS} FROM job_offers
      WHERE status = 'open' AND audience @> ARRAY[$1]::text[] ORDER BY opened_at DESC, delivery_id LIMIT $2`,
    [key, limit],
  );
  return rows.map(toOffer);
}

/** Staff: every offer in the given statuses. */
export async function listOffers(
  db: Db,
  input: { statuses: ('scheduled' | 'open')[]; sort: 'openedAt:desc' | 'opensAt:asc'; limit: number },
): Promise<WithId<JobOffer>[]> {
  const order =
    input.sort === 'opensAt:asc' ? 'opens_at ASC, delivery_id' : 'opened_at DESC NULLS LAST, delivery_id';
  const { rows } = await db.query<OfferRow>(
    `SELECT ${COLUMNS} FROM job_offers WHERE status = ANY($1::text[]) ORDER BY ${order} LIMIT $2`,
    [input.statuses, input.limit],
  );
  return rows.map(toOffer);
}

/** Statement (i), second half: up to 20 active, online drivers whose key is in the audience. */
export async function onlineDriversFor(tx: Tx, audience: readonly string[]): Promise<string[]> {
  if (audience.length === 0) return [];
  const { rows } = await tx.query<{ id: string }>(
    `SELECT u.id FROM users u JOIN driver_locations l ON l.driver_id = u.id
      WHERE u.role = 'driver' AND u.status = 'active' AND l.online
        AND (u.city_id || ':' || u.capacity_class) = ANY($1::text[])
      ORDER BY l.updated_at DESC LIMIT 20`,
    [[...audience]],
  );
  return rows.map((row) => row.id);
}

/** publishDueJobOffers candidates (index 20 and 21). */
export async function dueScheduledOfferIds(db: Db, now: number, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ delivery_id: string }>(
    `SELECT delivery_id FROM job_offers WHERE status = 'scheduled' AND opens_at <= $1
      ORDER BY opens_at, delivery_id LIMIT $2`,
    [new Date(now), limit],
  );
  return rows.map((row) => row.delivery_id);
}

export async function unclaimedOfferIds(db: Db, before: number, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ delivery_id: string }>(
    `SELECT delivery_id FROM job_offers WHERE status = 'open' AND NOT nudged AND opened_at <= $1
      ORDER BY opened_at, delivery_id LIMIT $2`,
    [new Date(before), limit],
  );
  return rows.map((row) => row.delivery_id);
}

/** The jobsite and window of the store order a marketplace delivery fulfils (read in the transaction). */
export async function offerInputs(
  tx: Tx,
  storeOrderId: string,
  storeId: string,
): Promise<{
  jobsite: { areaLabel: string; maxVehicleClass: string | null } | null;
  window: { kind: 'asap' | 'scheduled'; startAt: number | null; endAt: number } | null;
  storeAreaLabel: string | null;
}> {
  const { rows } = await tx.query<{
    jobsite: { areaLabel?: string; maxVehicleClass?: string | null } | null;
    window: { kind: 'asap' | 'scheduled'; startAt: number | null; endAt: number } | null;
  }>(`SELECT doc->'jobsite' AS jobsite, doc->'window' AS window FROM store_orders WHERE id = $1`, [
    storeOrderId,
  ]);
  const store = await tx.query<{ area_label: string | null }>(
    `SELECT doc->>'areaLabel' AS area_label FROM stores WHERE id = $1`,
    [storeId],
  );
  const row = rows[0];
  return {
    jobsite: row?.jobsite
      ? { areaLabel: row.jobsite.areaLabel ?? '', maxVehicleClass: row.jobsite.maxVehicleClass ?? null }
      : null,
    window: row?.window ?? null,
    storeAreaLabel: store.rows[0]?.area_label ?? null,
  };
}
