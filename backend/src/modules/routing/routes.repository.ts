/** The `routes` table (docs/PLATFORM.md §3.3): `RoutePlan` = `driverId`, `doc`, `computedAt`; the signature is private. */
import type { RoutePlan } from '@instasupply/shared';
import type { Queryable } from '../../platform/db/tx';

export type RouteRow = {
  driver_id: string;
  doc: Omit<RoutePlan, 'driverId' | 'computedAt'>;
  signature: string | null;
  computed_at: number;
};

export const toRoutePlan = (row: RouteRow): RoutePlan => ({
  driverId: row.driver_id,
  ...row.doc,
  computedAt: row.computed_at,
});

export async function findRoute(db: Queryable, driverId: string): Promise<RouteRow | null> {
  const { rows } = await db.query<RouteRow>(
    'SELECT driver_id, doc, signature, computed_at FROM routes WHERE driver_id = $1',
    [driverId],
  );
  return rows[0] ?? null;
}
