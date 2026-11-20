/**
 * The offer being built (MARKETPLACE §9 builder, right side): lines grouped by store with quantity,
 * agreed unit prices and notes; per store the load, distance, delivery fee, labourer and errors; the
 * live totals from `priceCheckout`; fulfilment, receiving, window, validity and the message.
 */
import {
  QUOTE_VALID_HOURS,
  VEHICLE_CLASSES,
  asapWindow,
  formatMoney,
  scheduledWindows,
  type PricedCheckout,
  type Product,
  type QuoteValidHours,
  type Receiving,
  type Store,
  type WindowOption,
  type WindowStoreInput,
  type WithId,
} from '@instasupply/shared';
import { useMemo, type Dispatch, type SetStateAction } from 'react';

import { IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Feedback';
import { Field, Segmented, Select, TextArea, TextInput } from '@/components/ui/Form';
import { DeleteIcon, WarningIcon } from '@/components/ui/icons';
import { ItemThumb } from '@/features/orders/components/ItemThumb';

import { unitPriceOf, type BuilderDraft, type DraftLine } from './draft';
import { PriceInput } from './PriceInput';
import { priceText } from './price-text';

function LineRow({
  line,
  live,
  update,
  remove,
  requestText,
  onPriceValidity,
}: {
  line: DraftLine;
  live: ReadonlyMap<string, Product>;
  update: (patch: Partial<DraftLine>) => void;
  remove: () => void;
  requestText: string | null;
  onPriceValidity: (valid: boolean) => void;
}) {
  const product = line.kind === 'catalog' ? live.get(line.productId) : undefined;
  const listCents = line.kind === 'catalog' ? (product?.priceCents ?? line.listPriceCents) : null;
  const unit = unitPriceOf(line, live);
  const unlisted = line.kind === 'catalog' && product !== undefined && !product.listed;

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <ItemThumb
          item={
            line.kind === 'catalog'
              ? { imageUrl: line.imageUrl, imageKey: line.imageKey, categoryId: line.categoryId }
              : {}
          }
          size="sm"
        />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-slate-900">
            {line.name}
            {line.kind === 'custom' ? (
              <span className="ml-2 text-xs font-normal text-sky-700">Special order</span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500">
            {[line.kind === 'catalog' ? line.sku : null, line.size, line.unit].filter(Boolean).join(' · ')}
            {requestText ? ` · for “${requestText}”` : ''}
          </p>
          {unlisted ? (
            <p className="text-xs font-medium text-rose-700">No longer listed: remove it or replace it.</p>
          ) : null}
          {product && product.stockOnHand - product.reserved < line.quantity ? (
            <p className="text-xs text-amber-700">
              Only {Math.max(0, product.stockOnHand - product.reserved)} in stock now.
            </p>
          ) : null}
        </div>
        <p className="text-right text-sm font-medium tabular-nums">{formatMoney(unit * line.quantity)}</p>
        <IconButton icon={DeleteIcon} size="sm" label={`Remove ${line.name}`} onClick={remove} />
      </div>
      <div className="flex flex-wrap items-center gap-3 pl-12">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          Qty
          <TextInput
            type="number"
            min={1}
            max={9999}
            value={line.quantity}
            aria-label={`Quantity of ${line.name}`}
            className="h-8 w-20"
            onChange={(event) =>
              update({ quantity: Math.max(0, Math.min(9999, Math.floor(Number(event.target.value) || 0))) })
            }
          />
        </label>
        {line.kind === 'catalog' ? (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Agreed price $
            <PriceInput
              cents={line.overrideCents}
              placeholder={listCents !== null ? priceText(listCents) : ''}
              label={`Agreed unit price of ${line.name}, empty for the list price`}
              className="h-8 w-24"
              onChange={(overrideCents) => update({ overrideCents })}
              onValidity={onPriceValidity}
            />
            {listCents !== null ? (
              <span className="text-slate-400">list {formatMoney(listCents)}</span>
            ) : null}
          </label>
        ) : (
          <span className="text-xs text-slate-600">Unit {formatMoney(line.unitPriceCents)}</span>
        )}
        <TextInput
          value={line.note}
          placeholder="Note for the customer"
          aria-label={`Note on ${line.name}`}
          maxLength={200}
          className="h-8 min-w-40 flex-1"
          onChange={(event) => update({ note: event.target.value })}
        />
      </div>
    </li>
  );
}

export function OfferPanel({
  draft,
  setDraft,
  priced,
  live,
  stores,
  requestTexts,
  hasJobsite,
  now,
  onPriceValidity,
}: {
  draft: BuilderDraft;
  setDraft: Dispatch<SetStateAction<BuilderDraft | null>>;
  priced: PricedCheckout;
  live: ReadonlyMap<string, Product>;
  stores: ReadonlyMap<string, WithId<Store>>;
  requestTexts: string[];
  hasJobsite: boolean;
  now: number;
  /** A line's agreed-price text became valid or invalid (Send waits while any is invalid). */
  onPriceValidity: (lineKey: string, valid: boolean) => void;
}) {
  const patch = (next: Partial<BuilderDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));
  const updateLine = (key: string, next: Partial<DraftLine>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.key === key ? ({ ...line, ...next } as DraftLine) : line,
            ),
          }
        : current,
    );
  const removeLine = (key: string) =>
    setDraft((current) =>
      current ? { ...current, lines: current.lines.filter((line) => line.key !== key) } : current,
    );

  const delivery = draft.fulfilment === 'delivery';
  const windows = useMemo((): WindowOption[] => {
    if (!delivery) return [];
    const inputs: WindowStoreInput[] = priced.stores.flatMap((part) => {
      const store = stores.get(part.storeId);
      return store && part.vehicleClass && part.roadTenths != null
        ? [{ storeId: part.storeId, store, vehicleClass: part.vehicleClass, roadTenths: part.roadTenths }]
        : [];
    });
    if (inputs.length === 0) return [];
    return [asapWindow(inputs, now), ...scheduledWindows(inputs, now)];
  }, [delivery, now, priced.stores, stores]);
  const chosenWindow = windows.find((window) => window.id === draft.windowId);

  const orphans = draft.lines.filter((line) => !stores.has(line.storeId));

  return (
    <div className="space-y-6">
      {priced.stores.length === 0 && orphans.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">
              No lines yet. Pick a request line on the left and add listings, or add a special order.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {priced.stores.map((part) => {
        const store = stores.get(part.storeId);
        const lines = draft.lines.filter((line) => line.storeId === part.storeId);
        return (
          <Card key={part.storeId}>
            <CardHeader
              title={`${part.letter} · ${store?.name ?? part.storeId}`}
              description={[
                `${part.load.weightKg} kg`,
                part.vehicleClass ? VEHICLE_CLASSES[part.vehicleClass].label : 'Too large for one vehicle',
                part.roadKm != null ? `${part.roadKm.toFixed(1)} km to the site` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <ul className="divide-y divide-slate-100">
              {lines.map((line) => (
                <LineRow
                  key={line.key}
                  line={line}
                  live={live}
                  requestText={line.requestLine !== null ? (requestTexts[line.requestLine] ?? null) : null}
                  update={(next) => updateLine(line.key, next)}
                  remove={() => removeLine(line.key)}
                  onPriceValidity={(valid) => onPriceValidity(line.key, valid)}
                />
              ))}
            </ul>
            <CardBody className="border-t border-slate-100">
              {part.errors.length > 0 ? (
                <Callout tone="danger" icon={WarningIcon}>
                  {part.errors.map((error) => error.message).join(' · ')}
                </Callout>
              ) : null}
              <dl className="divide-y divide-slate-100">
                <DetailRow label="Items">{formatMoney(part.itemsCents)}</DetailRow>
                {part.discountCents > 0 ? (
                  <DetailRow label="Discount">−{formatMoney(part.discountCents)}</DetailRow>
                ) : null}
                {delivery ? (
                  <DetailRow label="Delivery">
                    {part.feeWaiver ? (
                      <s className="mr-2 text-slate-400">{formatMoney(part.deliveryFeeListCents)}</s>
                    ) : null}
                    {formatMoney(part.deliveryFeeCents)}
                  </DetailRow>
                ) : null}
                {delivery && part.unload.offered ? (
                  <DetailRow label="Labourer">
                    <label className="inline-flex items-center gap-2 font-normal">
                      <input
                        type="checkbox"
                        checked={part.unload.selected}
                        disabled={part.unload.required}
                        onChange={(event) =>
                          patch({
                            unloadHelpStoreIds: event.target.checked
                              ? [...new Set([...draft.unloadHelpStoreIds, part.storeId])]
                              : draft.unloadHelpStoreIds.filter((id) => id !== part.storeId),
                          })
                        }
                      />
                      {part.unload.required ? 'Required: heavy load, nobody on site' : 'Add help unloading'}
                    </label>
                    <span className="ml-2">{formatMoney(part.unloadFeeCents)}</span>
                  </DetailRow>
                ) : null}
                <DetailRow label="HST">{formatMoney(part.taxCents)}</DetailRow>
                <DetailRow label={`Store ${part.letter} total`}>
                  <span className="font-semibold">{formatMoney(part.totalCents)}</span>
                </DetailRow>
              </dl>
            </CardBody>
          </Card>
        );
      })}

      {orphans.length > 0 ? (
        <Callout tone="warning" icon={WarningIcon} title="Lines from a store that is not in the list">
          {orphans.map((line) => line.name).join(', ')}. Remove them before sending.
        </Callout>
      ) : null}

      <Card>
        <CardHeader title="Offer" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Segmented
              ariaLabel="Fulfilment"
              value={draft.fulfilment}
              onChange={(fulfilment) => patch({ fulfilment, windowId: null })}
              options={[
                { value: 'delivery', label: 'Delivery' },
                { value: 'pickup', label: 'Pickup' },
              ]}
            />
            {delivery ? (
              <Segmented<Receiving>
                ariaLabel="Receiving"
                value={draft.receiving}
                onChange={(receiving) => patch({ receiving })}
                options={[
                  { value: 'attended', label: 'Someone on site' },
                  { value: 'unattended', label: 'Unattended' },
                ]}
              />
            ) : null}
          </div>
          {delivery && !hasJobsite ? (
            <Callout tone="warning" icon={WarningIcon}>
              The customer sent no jobsite, so delivery cannot be priced. Ask them for the site, or quote
              pickup.
            </Callout>
          ) : null}
          {delivery ? (
            <Field
              label="Window"
              hint={
                chosenWindow && !chosenWindow.available
                  ? chosenWindow.reason
                  : 'Checked again when the customer accepts.'
              }
            >
              {(id, describedBy) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={draft.windowId ?? ''}
                  onChange={(event) => patch({ windowId: event.target.value || null })}
                >
                  <option value="">Let the customer choose</option>
                  {windows.map((window) => (
                    <option key={window.id} value={window.id} disabled={!window.available}>
                      {window.label}
                      {window.available ? '' : ` — ${window.reason}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Valid for">
            {(id) => (
              <Select
                id={id}
                value={String(draft.validHours)}
                onChange={(event) => patch({ validHours: Number(event.target.value) as QuoteValidHours })}
              >
                {QUOTE_VALID_HOURS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} hours
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Message to the customer">
            {(id) => (
              <TextArea
                id={id}
                value={draft.message}
                maxLength={1000}
                placeholder="Kestrel can cut the studs to 92-5/8 in at no charge. The LVL is a special order, ready Friday."
                onChange={(event) => patch({ message: event.target.value })}
              />
            )}
          </Field>
          <Field label="Internal note (not sent)">
            {(id) => (
              <TextArea
                id={id}
                value={draft.internalNote}
                maxLength={2000}
                onChange={(event) => patch({ internalNote: event.target.value })}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Totals"
          description="Live from the same pricing as checkout. The server prices it again on send."
        />
        <CardBody>
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Items">{formatMoney(priced.itemsCents)}</DetailRow>
            {priced.discounts.map((discount) => (
              <DetailRow key={discount.label} label={discount.label}>
                −{formatMoney(discount.cents)}
              </DetailRow>
            ))}
            {delivery ? (
              <DetailRow label="Delivery">
                {formatMoney(priced.deliveryFeeCents)}
                {priced.freeDelivery ? (
                  <span className="block text-xs font-normal text-slate-500">
                    {priced.freeDelivery === 'first_order' ? 'Free: first order' : 'Free: over $500 of items'}
                  </span>
                ) : null}
              </DetailRow>
            ) : null}
            {priced.unloadFeeCents > 0 ? (
              <DetailRow label="Labourer">{formatMoney(priced.unloadFeeCents)}</DetailRow>
            ) : null}
            <DetailRow label="HST (13 %)">{formatMoney(priced.taxCents)}</DetailRow>
            <DetailRow label="Total">
              <span className="text-lg font-semibold">{formatMoney(priced.totalCents)}</span>
            </DetailRow>
          </dl>
          {priced.blockers.length > 0 && draft.lines.length > 0 ? (
            <ul
              className="mt-3 list-disc space-y-1 pl-5 text-xs text-rose-700"
              aria-label="What blocks sending"
            >
              {[...new Set(priced.blockers.map((blocker) => blocker.message))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
