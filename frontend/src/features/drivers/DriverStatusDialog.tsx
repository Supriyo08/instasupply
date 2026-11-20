import {
  capacityClassFor,
  VEHICLE_CLASS_IDS,
  VEHICLE_TYPE_LABELS,
  type VehicleClass,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea } from '@/components/ui/Form';
import { ErrorIcon, InfoIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { awaitingPickup, cityName, vehicleClassLabel } from '@/features/deliveries/delivery-format';
import { call, errorMessage } from '@/lib/api';
import { useOpenDeliveries, type DriverRecord } from '@/lib/data';

export type DriverStatusAction = 'approve' | 'suspend' | 'reactivate';

const COPY: Record<
  DriverStatusAction,
  { title: string; description: string; confirm: string; success: string }
> = {
  approve: {
    title: 'Approve driver',
    description:
      'They can go online and claim jobs for their vehicle class right away, and get a notification. Check their licence and insurance first.',
    confirm: 'Approve',
    success: 'Driver approved',
  },
  suspend: {
    title: 'Suspend driver',
    description: 'Their account is disabled and they are signed out of every device.',
    confirm: 'Suspend',
    success: 'Driver suspended',
  },
  reactivate: {
    title: 'Reactivate driver',
    description: 'Their account is enabled again and they can sign back in and claim jobs.',
    confirm: 'Reactivate',
    success: 'Driver reactivated',
  },
};

/**
 * Approve (both compliance checks required, optional capacity class override), suspend (shows which
 * jobs go back to the board) or reactivate a driver: `setDriverStatus`, admin only. Errors stay in the
 * dialog (R52).
 */
export function DriverStatusDialog({
  driver,
  action,
  onClose,
}: {
  driver: DriverRecord | null;
  action: DriverStatusAction | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const open = useOpenDeliveries();
  const [reason, setReason] = useState('');
  const [licence, setLicence] = useState(false);
  const [insurance, setInsurance] = useState(false);
  const [capacity, setCapacity] = useState<VehicleClass | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = action ? COPY[action] : null;

  const jobs = useMemo(
    () => (driver ? open.data.filter((delivery) => delivery.driverId === driver.id) : []),
    [driver, open.data],
  );
  const backToBoard = jobs.filter((delivery) => delivery.kind === 'marketplace' && awaitingPickup(delivery));
  const staying = jobs.filter((delivery) => !backToBoard.includes(delivery));

  const vehicle = driver?.vehicle ?? driver?.vehicleDraft ?? null;
  const derived = vehicle ? capacityClassFor(vehicle) : null;

  const close = () => {
    if (busy) return;
    setReason('');
    setLicence(false);
    setInsurance(false);
    setCapacity('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!driver || !action || busy) return;
    if (action === 'approve' && (!licence || !insurance)) {
      setError('Tick both checks: approval needs a verified licence and insurance.');
      return;
    }
    if (action === 'suspend' && !reason.trim()) {
      setError('Say why, so the team knows later.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('setDriverStatus', {
        uid: driver.id,
        status: action === 'suspend' ? 'suspended' : 'active',
        reason: action === 'suspend' ? reason.trim().slice(0, 200) : null,
        ...(action === 'approve'
          ? { licenceVerified: true, insuranceVerified: true, capacityClass: capacity || null }
          : {}),
      });
      toast.success(copy!.success, driver.displayName);
      setBusy(false);
      close();
    } catch (caught) {
      setBusy(false);
      setError(errorMessage(caught));
    }
  };

  return (
    <Modal
      open={!!driver && !!action}
      onClose={close}
      size="sm"
      title={copy && driver ? `${copy.title}: ${driver.displayName}` : ''}
      description={copy?.description}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={action === 'suspend' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void confirm()}
          >
            {copy?.confirm}
          </Button>
        </>
      }
    >
      {driver ? (
        <div className="space-y-4 text-sm">
          {action === 'approve' ? (
            <>
              <dl className="space-y-1 text-slate-600">
                <div>
                  <dt className="inline font-medium text-slate-800">City: </dt>
                  <dd className="inline">{cityName(driver.cityId)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-800">Vehicle: </dt>
                  <dd className="inline">
                    {vehicle
                      ? `${vehicle.year} ${vehicle.make} ${vehicle.model} (${VEHICLE_TYPE_LABELS[vehicle.type]}) · ${vehicle.plate}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-800">Phone: </dt>
                  <dd className="inline">{driver.phoneNumber ?? 'Not verified yet'}</dd>
                </div>
              </dl>
              <fieldset className="space-y-2">
                <legend className="mb-1 font-medium text-slate-800">Compliance</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={licence}
                    onChange={(event) => setLicence(event.target.checked)}
                    className="size-4 rounded border-slate-300"
                  />
                  Driver’s licence verified
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={insurance}
                    onChange={(event) => setInsurance(event.target.checked)}
                    className="size-4 rounded border-slate-300"
                  />
                  Commercial insurance verified
                </label>
              </fieldset>
              <Field
                label="Capacity class"
                hint={`From the vehicle: ${vehicleClassLabel(derived)}. Override only after seeing the vehicle.`}
              >
                {(id, describedBy) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value as VehicleClass | '')}
                  >
                    <option value="">Use {vehicleClassLabel(derived)}</option>
                    {VEHICLE_CLASS_IDS.map((vehicleClass) => (
                      <option key={vehicleClass} value={vehicleClass}>
                        {vehicleClassLabel(vehicleClass)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          ) : null}

          {action === 'suspend' ? (
            <>
              {jobs.length ? (
                <Callout tone="info" icon={InfoIcon} title="Their jobs">
                  {backToBoard.length ? (
                    <p>
                      Back to the job board:{' '}
                      {backToBoard.map((delivery, index) => (
                        <span key={delivery.id}>
                          {index ? ', ' : ''}
                          <Link to={`/deliveries/${delivery.id}`} className="font-medium underline">
                            {delivery.orderId}
                          </Link>
                        </span>
                      ))}
                      .
                    </p>
                  ) : null}
                  {staying.length ? (
                    <p className="mt-1">
                      Already collected or manual, so they stay with this driver and you are alerted:{' '}
                      {staying.map((delivery, index) => (
                        <span key={delivery.id}>
                          {index ? ', ' : ''}
                          <Link to={`/deliveries/${delivery.id}`} className="font-medium underline">
                            {delivery.orderId}
                          </Link>
                        </span>
                      ))}
                      . Reassign or follow them up.
                    </p>
                  ) : null}
                </Callout>
              ) : (
                <p className="text-slate-600">They have no open jobs.</p>
              )}
              <Field label="Reason" required hint="Kept on their profile for your team.">
                {(id, describedBy) => (
                  <TextArea
                    id={id}
                    aria-describedby={describedBy}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={200}
                    rows={3}
                  />
                )}
              </Field>
            </>
          ) : null}

          {error ? (
            <Callout tone="danger" icon={ErrorIcon}>
              {error}
            </Callout>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
