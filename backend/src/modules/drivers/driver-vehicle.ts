/**
 * `updateDriverVehicle` (active driver) and `reviewDriverVehicle` (admin), MARKETPLACE §5.4. A change goes to
 * `vehicleDraft` with `vehicleReviewRequired: true` until an admin approves it (the draft becomes the
 * vehicle, optionally with a class override) or rejects it. The job-board class (`capacity_class`, a mirror of
 * `doc.vehicle.capacityClass`) changes only on approval; meanwhile `claimJob` also checks the draft.
 */
import type { DriverVehicle, OkResponse, ReviewDriverVehicleRequest, UserProfile } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failedPrecondition, notFound } from '../../platform/http/errors';
import { notify, notifyStaff } from '../notifications';
import { checkedVehicle } from './register-driver';
import { lockUserRow, updateUser } from './repository';

export async function updateDriverVehicle(
  ctx: RequestContext,
  actor: Actor,
  raw: unknown,
): Promise<OkResponse> {
  await withTransaction(ctx.deps, async (tx) => {
    const row = await lockUserRow(tx, actor.uid);
    if (!row || row.role !== 'driver') notFound('That driver does not exist.');
    const draft = checkedVehicle(raw, tx.now);
    await updateUser(tx, actor.uid, { doc: { vehicleDraft: draft, vehicleReviewRequired: true } });
    await notifyStaff(
      tx,
      {
        type: 'vehicle_review',
        title: 'Vehicle change to review',
        body: `${row.display_name} changed their vehicle to ${draft.make} ${draft.model} · ${draft.plate}.`,
        data: { driverId: actor.uid },
        key: `vehicle-draft-${actor.uid}-${tx.now}`,
      },
      { adminsOnly: true },
    );
  });
  return { ok: true };
}

export async function reviewDriverVehicle(
  ctx: RequestContext,
  req: ReviewDriverVehicleRequest,
): Promise<OkResponse> {
  await withTransaction(ctx.deps, async (tx) => {
    const row = await lockUserRow(tx, req.uid);
    if (!row || row.role !== 'driver') notFound('That driver does not exist.');
    const doc = row.doc as Pick<UserProfile, 'vehicleDraft'>;
    const draft: DriverVehicle | null | undefined = doc.vehicleDraft;
    if (!draft) failedPrecondition('This driver has no vehicle change to review.');
    if (req.approve) {
      const vehicle: DriverVehicle = { ...draft, capacityClass: req.capacityClass ?? draft.capacityClass };
      await updateUser(tx, req.uid, { doc: { vehicle, vehicleDraft: null, vehicleReviewRequired: false } });
    } else {
      await updateUser(tx, req.uid, { doc: { vehicleDraft: null, vehicleReviewRequired: false } });
    }
    const note = req.note ? ` ${req.note}` : '';
    await notify(tx, req.uid, {
      type: 'vehicle_review',
      title: req.approve ? 'Vehicle approved' : 'Vehicle change not approved',
      body: req.approve
        ? `Your ${draft.make} ${draft.model} is approved. Your job board now matches it.${note}`
        : `Your vehicle change was not approved; your current vehicle stays on file.${note}`,
      key: `vehicle-${req.uid}-${tx.now}`,
    });
  });
  return { ok: true };
}
