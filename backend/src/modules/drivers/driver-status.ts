/**
 * `setDriverStatus` (admin; MARKETPLACE §5.4, docs/PLATFORM.md §6.4, §9.2.9), port of
 * legacy/…/auth/driver-status.ts. Approval needs both compliance checks (or `force`, honoured only when
 * `ALLOW_TEST_JOBS=true`) and may override the vehicle class. Suspension, in one transaction on the driver's
 * row: status and reason, every session revoked with reason `suspended`, the driver offline, `drop_user`.
 * After it commits every uncollected marketplace delivery of the driver is released, each in its own
 * transaction, and staff get one `system` notification listing the loads already on board.
 */
import {
  requiresPickup,
  type OkResponse,
  type SetDriverStatusRequest,
  type UserProfile,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { revokeAllSessions, setDriverOffline } from '../../platform/auth/sessions';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failedPrecondition, notFound } from '../../platform/http/errors';
import { publishControl } from '../../platform/live/publish';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { SYSTEM_ACTOR } from '../deliveries/delivery-writer';
import { stageRelease } from '../deliveries/release';
import { deliveryOf, openDeliveriesOfDriver } from '../deliveries/repository';
import { notify, notifyStaff } from '../notifications';
import { lockUserRow, updateUser } from './repository';

const UNCOLLECTED = new Set(['assigned', 'accepted']);

export async function setDriverStatus(
  ctx: RequestContext,
  actor: Actor,
  req: SetDriverStatusRequest,
): Promise<OkResponse> {
  const suspended = await withTransaction(ctx.deps, async (tx) => {
    const row = await lockUserRow(tx, req.uid);
    if (!row) notFound('Driver not found.');
    if (row.role !== 'driver') failedPrecondition('Only driver accounts can be approved or suspended here.');
    const doc = row.doc as Pick<UserProfile, 'compliance' | 'vehicle' | 'approvedAt'>;

    if (req.status === 'suspended') {
      if (row.status === 'suspended') return false;
      await updateUser(tx, req.uid, { status: 'suspended', doc: { suspendedReason: req.reason ?? null } });
      await revokeAllSessions(tx, req.uid, 'suspended');
      await setDriverOffline(tx, req.uid);
      await publishControl(tx, { ctl: 'drop_user', uid: req.uid });
      return true;
    }

    const compliance = doc.compliance ?? null;
    const licenceVerified = req.licenceVerified ?? compliance?.licenceVerified ?? false;
    const insuranceVerified = req.insuranceVerified ?? compliance?.insuranceVerified ?? false;
    const forced = req.force === true && ctx.deps.config.ALLOW_TEST_JOBS;
    const flagsUnchanged =
      licenceVerified === (compliance?.licenceVerified ?? false) &&
      insuranceVerified === (compliance?.insuranceVerified ?? false);
    const classUnchanged = !req.capacityClass || req.capacityClass === doc.vehicle?.capacityClass;
    if (row.status === 'active' && flagsUnchanged && classUnchanged) return false;
    if (!(licenceVerified && insuranceVerified) && !forced) {
      failedPrecondition('Verify the licence and the insurance before approving this driver.');
    }
    if (!doc.vehicle || !row.city_id) failedPrecondition('This driver has no city or vehicle to approve.');

    const becameActive = row.status !== 'active';
    const approvedAt = becameActive ? tx.now : (doc.approvedAt ?? tx.now);
    await updateUser(tx, req.uid, {
      status: 'active',
      doc: {
        compliance: {
          licenceAttestedAt: compliance?.licenceAttestedAt ?? tx.now,
          insuranceAttestedAt: compliance?.insuranceAttestedAt ?? tx.now,
          termsAcceptedAt: compliance?.termsAcceptedAt ?? tx.now,
          licenceVerified,
          insuranceVerified,
          verifiedBy: actor.uid,
          verifiedAt: tx.now,
        },
        vehicle: req.capacityClass ? { ...doc.vehicle, capacityClass: req.capacityClass } : doc.vehicle,
        ...(becameActive ? { approvedBy: actor.uid, approvedAt } : {}),
        suspendedReason: null,
      },
    });
    if (becameActive) {
      await notify(tx, req.uid, {
        type: 'account_approved',
        title: "You're approved!",
        body: 'Your driver account is active. Go online to start receiving jobs.',
        key: `approved-${req.uid}-${approvedAt}`,
      });
    }
    return false;
  });

  if (suspended) await releaseSuspendedDriver(ctx, req.uid, ctx.deps.clock.now());
  return { ok: true };
}

/** §9.2.9: release each uncollected marketplace job in its own transaction; tell staff about the rest. */
export async function releaseSuspendedDriver(ctx: RequestContext, uid: string, now: number): Promise<void> {
  const open = await openDeliveriesOfDriver(ctx.deps.pool, uid);
  const onBoard: string[] = [];
  for (const candidate of open) {
    if (
      candidate.kind !== 'marketplace' ||
      !UNCOLLECTED.has(candidate.status) ||
      !requiresPickup(candidate)
    ) {
      onBoard.push(candidate.orderId);
      continue;
    }
    try {
      await withTransaction(ctx.deps, async (tx) => {
        const graph = await lockGraph(tx, { deliveryIds: [candidate.id], userIds: [uid], withOffers: true });
        const delivery = deliveryOf(graph, candidate.id);
        if (
          !delivery ||
          delivery.driverId !== uid ||
          !UNCOLLECTED.has(delivery.status) ||
          !requiresPickup(delivery)
        ) {
          return;
        }
        const saved = await stageRelease(tx, graph, delivery, SYSTEM_ACTOR, {
          byDriverId: null,
          eventType: 'unassigned',
          message: 'Released: driver suspended',
        });
        await applyDeliveryEffects(tx, graph, delivery, saved);
      });
    } catch (error) {
      ctx.log.error({ err: error, deliveryId: candidate.id }, 'releasing a suspended driver’s job failed');
      onBoard.push(candidate.orderId);
    }
  }
  if (onBoard.length === 0) return;
  await withTransaction(
    ctx.deps,
    async (tx) => {
      const { rows } = await tx.query<{ display_name: string }>(
        'SELECT display_name FROM users WHERE id = $1',
        [uid],
      );
      await notifyStaff(tx, {
        type: 'system',
        title: `${rows[0]?.display_name ?? 'A driver'} was suspended with deliveries in progress`,
        body: `Still with the driver: ${onBoard.join(', ')}. Reassign or recover them.`,
        data: { driverId: uid },
        key: `suspended-${uid}-${now}`,
      });
    },
    { now },
  );
}
