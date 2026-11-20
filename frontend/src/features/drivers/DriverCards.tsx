import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  formatDateTimeET,
  formatRelativeTime,
  VEHICLE_CLASS_IDS,
  VEHICLE_EXTRA_LABELS,
  VEHICLE_TYPE_LABELS,
  type DriverVehicle,
  type VehicleClass,
} from '@instasupply/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { LoadMore } from '@/components/ui/Data';
import { Callout, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Segmented, Select, TextArea, TextInput } from '@/components/ui/Form';
import { ErrorIcon, PayoutIcon, ShieldIcon, TruckIcon } from '@/components/ui/icons';
import { Money } from '@/components/ui/Money';
import { useToast } from '@/components/ui/Toast';
import { vehicleClassLabel } from '@/features/deliveries/delivery-format';
import { LEDGER_KIND_LABEL } from '@/features/payouts/ledger-format';
import { api, call, errorMessage, queries } from '@/lib/api';
import type { DriverRecord } from '@/lib/data';

function VehicleFacts({ vehicle }: { vehicle: DriverVehicle }) {
  return (
    <dl className="divide-y divide-slate-100">
      <DetailRow label="Vehicle">
        {vehicle.year} {vehicle.make} {vehicle.model}
        {vehicle.colour ? `, ${vehicle.colour}` : ''}
      </DetailRow>
      <DetailRow label="Type">{VEHICLE_TYPE_LABELS[vehicle.type]}</DetailRow>
      <DetailRow label="Plate">
        <span className="font-mono">{vehicle.plate}</span>
      </DetailRow>
      {vehicle.boxLengthFt != null ? (
        <DetailRow label="Box length">{vehicle.boxLengthFt} ft</DetailRow>
      ) : null}
      {vehicle.payloadKg != null ? <DetailRow label="Payload">{vehicle.payloadKg} kg</DetailRow> : null}
      <DetailRow label="Extras">
        {vehicle.extras.length
          ? vehicle.extras.map((extra) => VEHICLE_EXTRA_LABELS[extra]).join(', ')
          : 'None'}
      </DetailRow>
      <DetailRow label="Capacity class">
        <span className="font-semibold">{vehicleClassLabel(vehicle.capacityClass)}</span>
      </DetailRow>
    </dl>
  );
}

function ClassSelect({
  value,
  onChange,
  label,
  hint,
}: {
  value: VehicleClass | '';
  onChange: (value: VehicleClass | '') => void;
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id, describedBy) => (
        <Select
          id={id}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value as VehicleClass | '')}
        >
          <option value="">Keep as declared</option>
          {VEHICLE_CLASS_IDS.map((vehicleClass) => (
            <option key={vehicleClass} value={vehicleClass}>
              {vehicleClassLabel(vehicleClass)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * The approved vehicle beside a change waiting for review (`vehicleDraft`), with Approve or Reject
 * (`reviewDriverVehicle`, admin) and an optional capacity class override (MARKETPLACE §9 drivers).
 */
export function VehicleCard({ driver, isAdmin }: { driver: DriverRecord; isAdmin: boolean }) {
  const toast = useToast();
  const [capacity, setCapacity] = useState<VehicleClass | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = driver.vehicleDraft ?? null;
  const reviewing = !!driver.vehicleReviewRequired && !!draft;

  const review = async (approve: boolean) => {
    if (busy) return;
    setBusy(approve ? 'approve' : 'reject');
    setError(null);
    try {
      await call('reviewDriverVehicle', {
        uid: driver.id,
        approve,
        capacityClass: approve && capacity ? capacity : null,
        note: note.trim() || null,
      });
      toast.success(approve ? 'Vehicle approved' : 'Vehicle change rejected', driver.displayName);
      setNote('');
      setCapacity('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <TruckIcon size={16} className="text-slate-500" aria-hidden /> Vehicle
          </span>
        }
        action={reviewing ? <Badge tone="warning">Change waiting for review</Badge> : null}
      />
      <CardBody className="space-y-4">
        <div className={reviewing ? 'grid gap-4 md:grid-cols-2' : undefined}>
          <div>
            {reviewing ? (
              <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Approved</p>
            ) : null}
            {driver.vehicle ? (
              <VehicleFacts vehicle={driver.vehicle} />
            ) : (
              <p className="text-sm text-slate-500">No approved vehicle yet.</p>
            )}
          </div>
          {reviewing && draft ? (
            <div className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-200">
              <p className="mb-1 text-xs font-semibold text-amber-800 uppercase">Draft</p>
              <VehicleFacts vehicle={draft} />
            </div>
          ) : null}
        </div>
        {reviewing && isAdmin ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <ClassSelect
              value={capacity}
              onChange={setCapacity}
              label="Capacity class on approval"
              hint={`Declared: ${vehicleClassLabel(draft?.capacityClass)}. Override only after seeing the vehicle.`}
            />
            <Field label="Note to the driver" hint="Optional; sent with a rejection.">
              {(id, describedBy) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
            {error ? (
              <Callout tone="danger" icon={ErrorIcon}>
                {error}
              </Callout>
            ) : null}
            <div className="flex gap-2">
              <Button loading={busy === 'approve'} disabled={!!busy} onClick={() => void review(true)}>
                Approve vehicle
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'reject'}
                disabled={!!busy}
                onClick={() => void review(false)}
              >
                Reject change
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * Licence and insurance: the driver's attestations and staff's verification. For an approved driver an
 * admin can update the checks and override the capacity class (`setDriverStatus` with `active`).
 */
export function ComplianceCard({
  driver,
  isAdmin,
  now,
}: {
  driver: DriverRecord;
  isAdmin: boolean;
  now: number;
}) {
  const toast = useToast();
  const compliance = driver.compliance ?? null;
  const [editing, setEditing] = useState(false);
  const [licence, setLicence] = useState(compliance?.licenceVerified ?? false);
  const [insurance, setInsurance] = useState(compliance?.insuranceVerified ?? false);
  const [capacity, setCapacity] = useState<VehicleClass | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    if (!licence || !insurance) {
      setError('An approved driver needs both checks. Suspend the driver instead if a document lapsed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('setDriverStatus', {
        uid: driver.id,
        status: 'active',
        licenceVerified: licence,
        insuranceVerified: insurance,
        ...(capacity ? { capacityClass: capacity } : {}),
      });
      toast.success('Driver updated', driver.displayName);
      setEditing(false);
      setCapacity('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldIcon size={16} className="text-slate-500" aria-hidden /> Compliance
          </span>
        }
        action={
          isAdmin && driver.status === 'active' && !editing ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {compliance ? (
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Licence">
              {compliance.licenceVerified ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <Badge tone="warning">Not verified</Badge>
              )}
            </DetailRow>
            <DetailRow label="Insurance">
              {compliance.insuranceVerified ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <Badge tone="warning">Not verified</Badge>
              )}
            </DetailRow>
            <DetailRow label="Attested">{formatDateTimeET(compliance.licenceAttestedAt, now)}</DetailRow>
            <DetailRow label="Terms accepted">{formatDateTimeET(compliance.termsAcceptedAt, now)}</DetailRow>
            {compliance.verifiedAt ? (
              <DetailRow label="Checked">{formatDateTimeET(compliance.verifiedAt, now)}</DetailRow>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">The driver has not finished sign-up yet.</p>
        )}
        <p className="text-xs text-slate-400">
          No licence or insurance images are stored (PIPEDA): check the originals.
        </p>
        {editing ? (
          <div className="space-y-3 border-t border-slate-100 pt-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={licence}
                onChange={(event) => setLicence(event.target.checked)}
                className="size-4"
              />
              Driver’s licence verified
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={insurance}
                onChange={(event) => setInsurance(event.target.checked)}
                className="size-4"
              />
              Commercial insurance verified
            </label>
            <ClassSelect
              value={capacity}
              onChange={setCapacity}
              label="Capacity class override"
              hint={`Now: ${vehicleClassLabel(driver.vehicle?.capacityClass)}. Job offers are matched on it.`}
            />
            {error ? (
              <Callout tone="danger" icon={ErrorIcon}>
                {error}
              </Callout>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={() => void save()}>
                Save
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

type LedgerFilter = 'all' | 'unpaid' | 'held';

/**
 * Earnings: the server's balance (never summed here), held entries with their issue, and the ledger
 * (`GET /ledger/balance`, `GET /ledger-entries?payeeType=driver&payeeId=`).
 */
export function EarningsCard({ driver, now }: { driver: DriverRecord; now: number }) {
  const balance = useLiveQuery(queries.ledgerBalance('driver', driver.id));
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const ledger = usePagedQuery(
    queries.ledger('driver', driver.id, {
      unpaid: filter === 'unpaid' ? true : null,
      held: filter === 'held' ? true : null,
    }),
  );
  const totals = balance.data;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <PayoutIcon size={16} className="text-slate-500" aria-hidden /> Earnings
          </span>
        }
        description={
          driver.driverStats
            ? `${driver.driverStats.deliveries} paid deliveries, all time`
            : 'Paid out in the daily run at 9 pm.'
        }
      />
      <CardBody className="space-y-4">
        {balance.loading && !totals ? (
          <Skeleton className="h-16 w-full" />
        ) : balance.error && !totals ? (
          <ErrorState error={balance.error} onRetry={balance.retry} title="Couldn't load the balance" />
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-[11px] text-slate-500 uppercase">Unpaid</p>
              <p className="text-sm font-semibold text-slate-900">
                <Money cents={totals?.unpaidCents ?? 0} />
              </p>
              <p className="text-[11px] text-slate-400">{totals?.unpaidCount ?? 0} entries</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-2.5">
              <p className="text-[11px] text-amber-800 uppercase">Held</p>
              <p className="text-sm font-semibold text-amber-900">
                <Money cents={totals?.heldCents ?? 0} />
              </p>
              <p className="text-[11px] text-amber-700">{totals?.heldCount ?? 0} entries</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-[11px] text-slate-500 uppercase">All time</p>
              <p className="text-sm font-semibold text-slate-900">
                <Money cents={driver.driverStats?.earnedCents ?? 0} />
              </p>
              <p className="text-[11px] text-slate-400">
                {totals?.lastPaidAt ? `Paid ${formatRelativeTime(totals.lastPaidAt, now)}` : 'Not paid yet'}
              </p>
            </div>
          </div>
        )}

        <Segmented
          ariaLabel="Ledger entries"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'held', label: 'Held' },
          ]}
        />
        {ledger.error && ledger.items.length === 0 ? (
          <ErrorState error={ledger.error} onRetry={ledger.retry} />
        ) : ledger.loading && ledger.items.length === 0 ? (
          <Skeleton className="h-24 w-full" />
        ) : ledger.items.length === 0 ? (
          <p className="text-sm text-slate-500">
            {filter === 'held'
              ? 'Nothing held for an issue.'
              : filter === 'unpaid'
                ? 'Nothing waiting to be paid.'
                : 'No earnings yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {ledger.items.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-800">{entry.description}</span>
                  <span className="block text-xs text-slate-500">
                    {LEDGER_KIND_LABEL[entry.kind]} · {formatDateTimeET(entry.createdAt, now)}
                    {entry.deliveryId ? (
                      <>
                        {' · '}
                        <Link
                          to={`/deliveries/${entry.deliveryId}`}
                          className="text-brand-600 hover:underline"
                        >
                          delivery
                        </Link>
                      </>
                    ) : null}
                  </span>
                  {entry.heldForIssueId ? (
                    <Link to={`/issues/${entry.heldForIssueId}`} className="mt-0.5 inline-block">
                      <Badge tone="warning">Held for an open issue</Badge>
                    </Link>
                  ) : entry.payoutId ? (
                    <Badge tone="success" className="mt-0.5">
                      Paid
                    </Badge>
                  ) : null}
                </span>
                <span
                  className={
                    entry.amountCents < 0 ? 'font-medium text-rose-600' : 'font-medium text-slate-900'
                  }
                >
                  <Money cents={entry.amountCents} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <LoadMore hasMore={ledger.hasMore} loadingMore={ledger.loadingMore} onLoadMore={ledger.loadMore} />
      </CardBody>
    </Card>
  );
}

/**
 * Where the daily run pays this driver (`PATCH /users/{uid}/payout-account`, admin). Until Stripe
 * Connect is set up the account is a test reference (MARKETPLACE §9).
 */
export function PayoutAccountCard({ driver, isAdmin }: { driver: DriverRecord; isAdmin: boolean }) {
  const toast = useToast();
  const account = driver.payoutAccount ?? null;
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<'test' | 'stripe'>(account?.provider ?? 'test');
  const [accountRef, setAccountRef] = useState(account?.accountRef ?? '');
  const [label, setLabel] = useState(account?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (remove = false) => {
    if (busy) return;
    if (!remove && (!accountRef.trim() || !label.trim())) {
      setError('Enter the account reference and a label the driver will recognise.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.users.setPayoutAccount(
        driver.id,
        remove ? null : { provider, accountRef: accountRef.trim(), label: label.trim() },
      );
      toast.success(remove ? 'Payout account removed' : 'Payout account saved', driver.displayName);
      setEditing(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Payout account"
        description="Test reference until Stripe Connect is set up."
        action={
          isAdmin && !editing ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {account ? 'Change' : 'Add'}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {account ? (
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Account">{account.label}</DetailRow>
            <DetailRow label="Reference">
              <span className="font-mono text-xs">{account.accountRef}</span>
            </DetailRow>
            <DetailRow label="Provider">{account.provider === 'test' ? 'Test transfer' : 'Stripe'}</DetailRow>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">
            No payout account. In Stripe mode the daily run skips this driver until one is added.
          </p>
        )}
        {editing ? (
          <form
            className="space-y-3 border-t border-slate-100 pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Provider</p>
              <Segmented
                ariaLabel="Payout provider"
                value={provider}
                onChange={setProvider}
                options={[
                  { value: 'test', label: 'Test' },
                  { value: 'stripe', label: 'Stripe' },
                ]}
              />
            </div>
            <Field
              label="Account reference"
              required
              hint={
                provider === 'test'
                  ? 'Any reference, for example test-marco.'
                  : 'The Stripe connected account id (acct_…).'
              }
            >
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={accountRef}
                  onChange={(event) => setAccountRef(event.target.value)}
                />
              )}
            </Field>
            <Field label="Label" required hint="What the driver sees, for example “RBC chequing ••4821”.">
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              )}
            </Field>
            {error ? (
              <Callout tone="danger" icon={ErrorIcon}>
                {error}
              </Callout>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="submit" loading={busy}>
                Save
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {account ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void save(true)}
                  className="ml-auto text-rose-600"
                >
                  Remove account
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
