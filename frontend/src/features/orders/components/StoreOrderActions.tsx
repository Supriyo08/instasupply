/**
 * Staff acting for a store on one store order (MARKETPLACE §9 order detail, §2.1): accept, start
 * preparing, mark ready, "not ready after all", confirm the collection with the PIN or an override,
 * reject or cancel with a reason, and resolve a failed delivery (re-attempt or return to the store).
 * Every action sends `expectedVersion`; a stale version reloads the store order and says so. Status
 * moves are never optimistic. One primary button, the rest in an "Actions" menu with the
 * destructive item last (ux #6).
 */
import {
  allowedStoreOrderTransitions,
  formatMoney,
  scheduledWindows,
  type StoreOrder,
  type StoreOrderPrivateMeta,
  type StoreRejectReason,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import {
  CancelIcon,
  CheckIcon,
  ChevronDownIcon,
  KeyIcon,
  PlayIcon,
  RefreshIcon,
  TruckIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { MenuItem, Popover } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { api, call, describeError, detailsFor, errorCodeOf } from '@/lib/api';

import { REJECT_REASONS } from '../order-format';
import { ActionDialog } from './ActionDialog';
import { ShortShipEditor, adjustmentsOf, type ShortShipDraft } from './ShortShipEditor';

type DialogKind = 'accept' | 'ready' | 'reject' | 'cancel' | 'pickup' | 'resolve' | null;

const CONFLICT_MESSAGE =
  'This store order changed while you were looking at it. The latest version is loading: check it and try again.';

/** The error text for a store-order action; a stale version also reloads the order (CONVENTIONS §3.5). */
export function explainStoreOrderError(error: unknown, storeOrderId: string): string {
  if (errorCodeOf(error) === 'VERSION_CONFLICT') {
    void api.cache.invalidate(['store-order', storeOrderId]);
    void api.cache.invalidate(['store-orders']);
    return CONFLICT_MESSAGE;
  }
  const remaining = detailsFor(error, 'CODE_INCORRECT')?.remaining;
  if (remaining !== undefined) {
    return remaining > 0
      ? `That PIN is not right. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`
      : 'That PIN is not right and the PIN is now locked. Use an override with a reason.';
  }
  return describeError(error);
}

export function StoreOrderActions({
  storeOrder,
  privateMeta,
}: {
  storeOrder: StoreOrder;
  privateMeta: StoreOrderPrivateMeta | null;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState<'preparing' | 'unready' | null>(null);
  const targets = allowedStoreOrderTransitions(storeOrder.status, 'staff', {
    fulfilment: storeOrder.fulfilment,
  });
  const { status } = storeOrder;

  const quickMove = async (kind: 'preparing' | 'unready') => {
    if (busy) return;
    setBusy(kind);
    try {
      await call('updateStoreOrderStatus', {
        storeOrderId: storeOrder.id,
        expectedVersion: storeOrder.version,
        status: 'preparing',
      });
      toast.success(
        kind === 'preparing'
          ? `${storeOrder.number} is being prepared`
          : `${storeOrder.number} is back in preparing`,
      );
    } catch (error) {
      toast.error("Couldn't update the store order", explainStoreOrderError(error, storeOrder.id));
    } finally {
      setBusy(null);
    }
  };

  const canAccept = status === 'new' && targets.includes('accepted');
  const canPrepare = status === 'accepted' && targets.includes('preparing');
  const canReady = targets.includes('ready');
  const canUnready = status === 'ready' && targets.includes('preparing');
  const canCollect = targets.includes('out_for_delivery') || targets.includes('picked_up');
  const canReject = status === 'new' && targets.includes('rejected');
  const canCancel = status !== 'new' && status !== 'failed' && targets.includes('cancelled');
  const canResolve = status === 'failed';

  let primary: { label: string; icon: typeof CheckIcon; onClick: () => void; loading?: boolean } | null =
    null;
  if (canAccept)
    primary = { label: 'Accept for the store', icon: CheckIcon, onClick: () => setDialog('accept') };
  else if (canPrepare) {
    primary = {
      label: 'Start preparing',
      icon: PlayIcon,
      onClick: () => void quickMove('preparing'),
      loading: busy === 'preparing',
    };
  } else if (status === 'preparing' && canReady) {
    primary = { label: 'Mark ready', icon: CheckIcon, onClick: () => setDialog('ready') };
  } else if (canCollect) {
    primary = { label: 'Confirm collection', icon: KeyIcon, onClick: () => setDialog('pickup') };
  } else if (canResolve) {
    primary = { label: 'Resolve failed delivery', icon: RefreshIcon, onClick: () => setDialog('resolve') };
  }

  const menu: { label: string; icon: typeof CheckIcon; onClick: () => void; danger?: boolean }[] = [];
  if (status === 'accepted' && canReady) {
    menu.push({ label: 'Mark ready', icon: CheckIcon, onClick: () => setDialog('ready') });
  }
  if (canUnready) {
    menu.push({ label: 'Not ready after all', icon: RefreshIcon, onClick: () => void quickMove('unready') });
  }
  if (canReject)
    menu.push({
      label: 'Reject for the store',
      icon: CancelIcon,
      onClick: () => setDialog('reject'),
      danger: true,
    });
  if (canCancel) {
    menu.push({
      label: 'Cancel store order',
      icon: CancelIcon,
      onClick: () => setDialog('cancel'),
      danger: true,
    });
  }

  if (!primary && menu.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary ? (
        <Button size="sm" icon={primary.icon} loading={primary.loading} onClick={primary.onClick}>
          {primary.label}
        </Button>
      ) : null}
      {menu.length > 0 ? (
        <Popover
          trigger={({ open, toggle }) => (
            <Button
              size="sm"
              variant="secondary"
              trailingIcon={ChevronDownIcon}
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={toggle}
              loading={busy === 'unready'}
            >
              Actions
            </Button>
          )}
          className="w-56 p-1.5"
        >
          {(close) => (
            <div role="menu" aria-label={`Actions for ${storeOrder.number}`}>
              {menu.map((item, index) => {
                const Icon = item.icon;
                const divider = item.danger && index > 0 && !menu[index - 1]?.danger;
                return (
                  <div key={item.label}>
                    {divider ? <div className="my-1 border-t border-slate-100" /> : null}
                    <MenuItem
                      tone={item.danger ? 'danger' : 'default'}
                      icon={<Icon size={16} aria-hidden />}
                      onClick={() => {
                        close();
                        item.onClick();
                      }}
                    >
                      {item.label}
                    </MenuItem>
                  </div>
                );
              })}
            </div>
          )}
        </Popover>
      ) : null}

      {dialog === 'accept' || dialog === 'ready' ? (
        <AcceptOrReadyDialog kind={dialog} storeOrder={storeOrder} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'reject' || dialog === 'cancel' ? (
        <RejectDialog kind={dialog} storeOrder={storeOrder} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'pickup' ? (
        <PickupDialog storeOrder={storeOrder} privateMeta={privateMeta} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'resolve' ? (
        <ResolveFailedDialog storeOrder={storeOrder} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function AcceptOrReadyDialog({
  kind,
  storeOrder,
  onClose,
}: {
  kind: 'accept' | 'ready';
  storeOrder: StoreOrder;
  onClose: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ShortShipDraft>({});
  const [note, setNote] = useState('');
  const adjustments = adjustmentsOf(storeOrder.lines, draft);

  const confirm = async () => {
    const common = {
      storeOrderId: storeOrder.id,
      expectedVersion: storeOrder.version,
      adjustments: adjustments.length > 0 ? adjustments : undefined,
      note: note.trim() || null,
    };
    if (kind === 'accept') await call('acceptStoreOrder', common);
    else await call('updateStoreOrderStatus', { ...common, status: 'ready' });
    toast.success(kind === 'accept' ? `${storeOrder.number} accepted` : `${storeOrder.number} is ready`);
  };

  return (
    <ActionDialog
      open
      onClose={onClose}
      size="lg"
      title={
        kind === 'accept'
          ? `Accept ${storeOrder.number} for ${storeOrder.storeName}`
          : `Mark ${storeOrder.number} ready`
      }
      description={
        kind === 'accept'
          ? 'Only do this when the store has confirmed by phone. The customer is told the order is confirmed.'
          : 'The load is packed and waiting at the counter. For delivery, the job goes to drivers.'
      }
      confirmLabel={kind === 'accept' ? 'Accept order' : 'Mark ready'}
      onConfirm={confirm}
      explainError={(error) => explainStoreOrderError(error, storeOrder.id)}
    >
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Short shipment</p>
        <p className="text-xs text-slate-500">
          Lower a quantity only when the store cannot supply all of it. The customer is charged for what
          ships.
        </p>
        <ShortShipEditor lines={storeOrder.lines} value={draft} onChange={setDraft} />
      </div>
      {adjustments.length > 0 ? (
        <Callout tone="warning" icon={WarningIcon}>
          {adjustments.length} {adjustments.length === 1 ? 'line ships' : 'lines ship'} short. The totals are
          recalculated and the customer is told.
        </Callout>
      ) : null}
      <Field label="Note for the history (optional)">
        {(id) => (
          <TextInput id={id} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        )}
      </Field>
    </ActionDialog>
  );
}

function RejectDialog({
  kind,
  storeOrder,
  onClose,
}: {
  kind: 'reject' | 'cancel';
  storeOrder: StoreOrder;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<StoreRejectReason>('out_of_stock');
  const [note, setNote] = useState('');
  const needsNote = reason === 'other' && note.trim().length === 0;

  return (
    <ActionDialog
      open
      onClose={onClose}
      tone="danger"
      title={kind === 'reject' ? `Reject ${storeOrder.number}` : `Cancel ${storeOrder.number}`}
      description={
        kind === 'reject'
          ? `${storeOrder.storeName} will not supply this order. The reserved stock is released, nothing is charged for it, and the customer is told.`
          : `The goods are still at ${storeOrder.storeName}. Cancelling releases the stock, withdraws the driver job if there is one, and the customer is not charged for this store's items.`
      }
      confirmLabel={kind === 'reject' ? 'Reject order' : 'Cancel store order'}
      confirmDisabled={needsNote}
      onConfirm={async () => {
        await call('rejectStoreOrder', {
          storeOrderId: storeOrder.id,
          expectedVersion: storeOrder.version,
          reason,
          note: note.trim() || null,
        });
        toast.success(kind === 'reject' ? `${storeOrder.number} rejected` : `${storeOrder.number} cancelled`);
      }}
      explainError={(error) => explainStoreOrderError(error, storeOrder.id)}
    >
      <Field label="Reason" required>
        {(id) => (
          <Select
            id={id}
            value={reason}
            onChange={(event) => setReason(event.target.value as StoreRejectReason)}
          >
            {REJECT_REASONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={reason === 'other' ? 'What happened' : 'Note (optional)'}
        required={reason === 'other'}
        hint="Kept in the order history; the customer sees the reason."
      >
        {(id, describedBy) => (
          <TextArea
            id={id}
            aria-describedby={describedBy}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
    </ActionDialog>
  );
}

function PickupDialog({
  storeOrder,
  privateMeta,
  onClose,
}: {
  storeOrder: StoreOrder;
  privateMeta: StoreOrderPrivateMeta | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'pin' | 'override'>('pin');
  const [pin, setPin] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const delivery = storeOrder.fulfilment === 'delivery';
  const who = delivery
    ? storeOrder.driver
      ? `${storeOrder.driver.firstName}, the driver,`
      : 'the driver'
    : 'the customer';
  const invalid = mode === 'pin' ? !/^\d{4}$/.test(pin) : overrideReason.trim().length < 5;

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Confirm collection of ${storeOrder.number}`}
      description={
        delivery
          ? `Type the 4-digit PIN ${who} shows at the counter. The load then leaves with the driver.`
          : `Type the 4-digit PIN ${who} shows at the counter. The order is then picked up.`
      }
      confirmLabel={mode === 'pin' ? 'Confirm with PIN' : 'Confirm without PIN'}
      tone={mode === 'override' ? 'danger' : 'primary'}
      confirmDisabled={invalid}
      onConfirm={async () => {
        const result = await call('completePickup', {
          storeOrderId: storeOrder.id,
          expectedVersion: storeOrder.version,
          pickupCode: mode === 'pin' ? pin : null,
          overrideReason: mode === 'override' ? overrideReason.trim() : null,
        });
        toast.success(
          result.status === 'picked_up'
            ? `${storeOrder.number} picked up`
            : `${storeOrder.number} is out for delivery`,
        );
      }}
      explainError={(error) => explainStoreOrderError(error, storeOrder.id)}
    >
      {delivery && !storeOrder.driver ? (
        <Callout tone="warning" icon={TruckIcon}>
          No driver has claimed this job yet, so there is no driver PIN.
        </Callout>
      ) : null}
      {mode === 'pin' ? (
        <Field
          label="Pickup PIN"
          hint={
            privateMeta && privateMeta.codeAttempts > 0
              ? `${privateMeta.codeAttempts} wrong ${privateMeta.codeAttempts === 1 ? 'attempt' : 'attempts'} so far.`
              : 'Four digits.'
          }
        >
          {(id, describedBy) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={pin}
              autoFocus
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-32 text-center font-mono text-lg tracking-[0.4em]"
            />
          )}
        </Field>
      ) : (
        <Field label="Why there is no PIN" required hint="Recorded with your name in the order history.">
          {(id, describedBy) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              value={overrideReason}
              maxLength={500}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
          )}
        </Field>
      )}
      <Toggle
        checked={mode === 'override'}
        onChange={(checked) => setMode(checked ? 'override' : 'pin')}
        label="Override: confirm without the PIN"
        description="Staff only, for a phone that died or a locked PIN."
      />
    </ActionDialog>
  );
}

function ResolveFailedDialog({ storeOrder, onClose }: { storeOrder: StoreOrder; onClose: () => void }) {
  const toast = useToast();
  const [action, setAction] = useState<'reattempt' | 'return_to_store'>('reattempt');
  const [windowId, setWindowId] = useState('');
  const [refundDeliveryFee, setRefundDeliveryFee] = useState(false);
  const [note, setNote] = useState('');
  // The load is already on the truck, so a re-attempt picks from the calendar alone (§4.4).
  const windows = useMemo(
    () => scheduledWindows([], api.serverNow()).filter((window) => window.available),
    [],
  );
  const fees = storeOrder.current.deliveryFeeCents + storeOrder.current.unloadFeeCents;

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Resolve failed delivery ${storeOrder.number}`}
      description="The goods are with the driver. Send them out again, or bring them back to the store."
      confirmLabel={action === 'reattempt' ? 'Re-attempt delivery' : 'Return to store'}
      onConfirm={async () => {
        await call('resolveFailedDelivery', {
          storeOrderId: storeOrder.id,
          action,
          windowId: action === 'reattempt' ? windowId || null : null,
          refundDeliveryFee: action === 'return_to_store' ? refundDeliveryFee : undefined,
          note: note.trim() || null,
        });
        toast.success(
          action === 'reattempt'
            ? `${storeOrder.number} goes out again`
            : `${storeOrder.number} returns to the store`,
        );
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">What happens now</legend>
        {(
          [
            ['reattempt', 'Re-attempt', 'The order goes back on the road; the customer gets a new window.'],
            [
              'return_to_store',
              'Return to store',
              'The goods go back into stock and the items are never charged.',
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-slate-200 has-checked:ring-2 has-checked:ring-brand-500"
          >
            <input
              type="radio"
              name="resolve-action"
              value={value}
              checked={action === value}
              onChange={() => setAction(value)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-900">{label}</span>
              <span className="block text-xs text-slate-500">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {action === 'reattempt' ? (
        <Field label="New window" hint="Leave on “As soon as possible” to send it out with the next driver.">
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={windowId}
              onChange={(event) => setWindowId(event.target.value)}
            >
              <option value="">As soon as possible</option>
              {windows.map((window) => (
                <option key={window.id} value={window.id}>
                  {window.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Toggle
          checked={refundDeliveryFee}
          onChange={setRefundDeliveryFee}
          label={`Don't charge the delivery and labourer fees (${formatMoney(fees)})`}
          description="Use when the failure was not the site's fault, or as a goodwill gesture."
        />
      )}
      <Field label="Note (optional)">
        {(id) => (
          <TextArea id={id} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        )}
      </Field>
    </ActionDialog>
  );
}
