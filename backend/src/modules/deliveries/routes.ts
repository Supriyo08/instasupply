/**
 * The deliveries endpoints of docs/PLATFORM.md §5.3.5: lists, stats, one delivery, its events, its private
 * meta, the staff edit and the activity feed. HTTP only: policy, schema, the service, serialization.
 */
import type {
  Delivery,
  DeliveryEvent,
  DeliveryPatch,
  DeliveryPrivateMeta,
  DeliveryStats,
  Page,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../../platform/auth/actor';
import { requireAuth, requireStaff } from '../../platform/auth/policies';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { stageJobOffer } from '../jobs/offers';
import { canReadDelivery } from './access';
import { applyDeliveryEffects } from './delivery-effects';
import { eventActorOf } from './delivery-writer';
import {
  deliveryOf,
  deliveryStats,
  findDelivery,
  findMeta,
  insertEvent,
  listDeliveries,
  listEvents,
  saveDelivery,
  toDelivery,
} from './repository';
import {
  DeliveryListQuerySchema,
  DeliveryPatchSchema,
  DeliveryStatsQuerySchema,
  EventsQuerySchema,
} from './schemas';

/** Staff, or a driver (any status) for their own rows (§5.3 scoping rule). */
function requireOperatorReader(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (!actor.isStaff && actor.role !== 'driver') permissionDenied();
  return actor;
}

/** The scoping parameter `driverId`: a driver always gets their own rows; another id is refused. */
function scopedDriverId(actor: Actor, requested: string | undefined): string | undefined {
  if (actor.isStaff) return requested;
  if (requested !== undefined && requested !== actor.uid) permissionDenied();
  return actor.uid;
}

const numberCursor = (cursor: string | undefined): [number, string] | null => {
  if (!cursor) return null;
  const [value, id] = decodeCursor(cursor);
  if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
  return [value, id];
};

async function readableDelivery(ctx: RequestContext, actor: Actor, id: string): Promise<Delivery> {
  const delivery = await findDelivery(ctx.deps.pool, id);
  if (!delivery) {
    if (!actor.isStaff) permissionDenied('This delivery is not assigned to you.');
    notFound('This delivery no longer exists.');
  }
  if (!canReadDelivery(actor, delivery)) permissionDenied('This delivery is not assigned to you.');
  return delivery;
}

const PATCH_LABELS: Record<keyof DeliveryPatch, string> = {
  customer: 'contact',
  address: 'address',
  location: 'pin',
  addressNotes: 'directions',
  notes: 'notes',
  packageCount: 'packages',
  priority: 'priority',
  requireCode: 'hand-off code',
  windowStart: 'window',
  windowEnd: 'window',
  unload: 'unloading',
};

export async function patchDelivery(
  ctx: RequestContext,
  actor: Actor,
  id: string,
  patch: DeliveryPatch,
): Promise<Delivery> {
  const keys = Object.keys(patch) as (keyof DeliveryPatch)[];
  return withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, { deliveryIds: [id], withOffers: true });
    const delivery = deliveryOf(graph, id);
    if (!delivery) notFound('This delivery no longer exists.');
    if (keys.length === 0) return delivery;
    const next: Delivery = { ...delivery, updatedBy: actor.uid };
    if (patch.customer) next.customer = { ...patch.customer, email: patch.customer.email ?? null };
    if (patch.address !== undefined) next.address = patch.address;
    if (patch.location) next.location = patch.location;
    if (patch.addressNotes !== undefined) next.addressNotes = patch.addressNotes;
    if (patch.notes !== undefined) next.notes = patch.notes;
    if (patch.packageCount !== undefined) next.packageCount = patch.packageCount;
    if (patch.priority) next.priority = patch.priority;
    if (patch.requireCode !== undefined) next.requireCode = patch.requireCode;
    if (patch.windowStart !== undefined) next.windowStart = patch.windowStart;
    if (patch.windowEnd !== undefined) next.windowEnd = patch.windowEnd;
    if (next.windowStart !== null && next.windowEnd !== null && next.windowEnd < next.windowStart) {
      invalidArgument('The window must end after it starts.', {
        fields: { windowEnd: 'before windowStart' },
      });
    }
    if (patch.unload) {
      next.unload = {
        labourer: delivery.unload?.labourer ?? patch.unload.status !== 'not_needed',
        required: delivery.unload?.required ?? false,
        status: patch.unload.status,
        labourerName: patch.unload.labourerName,
        labourerPhone: patch.unload.labourerPhone,
      };
    }
    const saved = await saveDelivery(tx, graph, next);
    const fields = [...new Set(keys.map((key) => PATCH_LABELS[key]))].join(', ');
    await insertEvent(tx, saved, eventActorOf(actor), {
      type: 'edited',
      message: `Edited by dispatch: ${fields}`,
    });
    const offer = graph.offers.get(id);
    if (offer) {
      const opensAt = (offer.doc as { opensAt?: number }).opensAt ?? tx.now;
      await stageJobOffer(tx, saved, { opensAt });
    }
    await applyDeliveryEffects(tx, graph, delivery, saved);
    return saved;
  });
}

export function registerDeliveryRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/deliveries',
    policy: requireOperatorReader,
    query: DeliveryListQuerySchema,
    handler: async (ctx, { query }, actor): Promise<Page<Delivery>> => {
      const caller = actor!;
      if (!caller.isStaff && (query.kind || query.storeId || query.unloadStatus || query.offerStatus)) {
        invalidArgument('That filter is for dispatch staff only.');
      }
      const driverId = scopedDriverId(caller, query.driverId);
      const rows = await listDeliveries(ctx.deps.pool, {
        ...(driverId !== undefined ? { driverId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.storeId ? { storeId: query.storeId } : {}),
        ...(query.unloadStatus ? { unloadStatus: query.unloadStatus } : {}),
        ...(query.offerStatus ? { offerStatus: query.offerStatus } : {}),
        ...(query.createdSince !== undefined ? { createdSince: query.createdSince } : {}),
        ...(query.updatedSince !== undefined ? { updatedSince: query.updatedSince } : {}),
        ...(query.deliveredSince !== undefined ? { deliveredSince: query.deliveredSince } : {}),
        sort: query.sort,
        limit: query.limit,
        cursor: numberCursor(query.cursor),
      });
      const updated = query.sort === 'updatedAt:desc';
      return readPage(rows, query.limit, toDelivery, (row) => [
        updated ? row.updated_at : row.created_at,
        row.id,
      ]);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/deliveries/stats',
    policy: requireOperatorReader,
    query: DeliveryStatsQuerySchema,
    handler: async (ctx, { query }, actor): Promise<DeliveryStats> => {
      const driverId = scopedDriverId(actor!, query.driverId);
      if (!driverId) invalidArgument('Choose a driver.', { fields: { driverId: 'required' } });
      return deliveryStats(ctx.deps.pool, driverId, query.since);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/deliveries/:deliveryId',
    policy: requireOperatorReader,
    params: z.object({ deliveryId: idParam }),
    handler: async (ctx, { params }, actor): Promise<Delivery> =>
      readableDelivery(ctx, actor!, params.deliveryId),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/deliveries/:deliveryId/events',
    policy: requireOperatorReader,
    params: z.object({ deliveryId: idParam }),
    query: EventsQuerySchema,
    handler: async (ctx, { params, query }, actor): Promise<Page<DeliveryEvent>> => {
      await readableDelivery(ctx, actor!, params.deliveryId);
      const cursor = numberCursor(query.cursor);
      const events = await listEvents(ctx.deps.pool, {
        deliveryId: params.deliveryId,
        limit: query.limit,
        beforeId: cursor ? cursor[0] : null,
      });
      return readPage(
        events,
        query.limit,
        (event) => event,
        (event) => [Number(event.id), event.id],
      );
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/deliveries/:deliveryId/private',
    policy: requireStaff,
    params: z.object({ deliveryId: idParam }),
    handler: async (ctx, { params }): Promise<DeliveryPrivateMeta> => {
      const meta = await findMeta(ctx.deps.pool, params.deliveryId);
      if (!meta) notFound('This delivery no longer exists.');
      return { trackingToken: meta.trackingToken, handoffCode: meta.handoffCode };
    },
  });

  defineRoute(app, {
    method: 'PATCH',
    url: '/deliveries/:deliveryId',
    policy: requireStaff,
    params: z.object({ deliveryId: idParam }),
    body: DeliveryPatchSchema,
    handler: async (ctx, { params, body }, actor): Promise<Delivery> =>
      patchDelivery(ctx, actor!, params.deliveryId, body),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/activity',
    policy: requireStaff,
    query: EventsQuerySchema,
    handler: async (ctx, { query }): Promise<Page<DeliveryEvent>> => {
      const cursor = numberCursor(query.cursor);
      const events = await listEvents(ctx.deps.pool, {
        deliveryId: null,
        limit: query.limit,
        beforeId: cursor ? cursor[0] : null,
      });
      return readPage(
        events,
        query.limit,
        (event) => event,
        (event) => [Number(event.id), event.id],
      );
    },
  });
}
