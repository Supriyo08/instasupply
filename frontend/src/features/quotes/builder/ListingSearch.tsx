/**
 * Listing search for one request line (MARKETPLACE §9 builder): listed products near the jobsite with
 * price, stock and road distance, added to that store's group; or the line is marked unmatched with a
 * reason; or a special-order line is added instead.
 */
import { useApiQuery } from '@instasupply/api-client/react';
import {
  availableQty,
  formatMoney,
  haversineMeters,
  estimateRoadMeters,
  type LatLng,
  type Product,
  type Store,
  type WithId,
} from '@instasupply/shared';
import { useEffect, useMemo, useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Spinner } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { CloseIcon, PlusIcon } from '@/components/ui/icons';
import { ItemThumb } from '@/features/orders/components/ItemThumb';
import { StoreSelect } from '@/features/stores/components/StoreSelect';
import { queries } from '@/lib/api';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function roadKm(from: LatLng | undefined, to: LatLng | null): number | null {
  if (!from || !to) return null;
  return estimateRoadMeters(haversineMeters(from, to)) / 1000;
}

export function ListingSearch({
  requestLine,
  initialText,
  initialQuantity,
  site,
  stores,
  onAdd,
  onUnmatched,
  onCustom,
  onClose,
}: {
  requestLine: number | null;
  initialText: string;
  initialQuantity: number;
  site: LatLng | null;
  stores: ReadonlyMap<string, WithId<Store>>;
  onAdd: (product: Product, quantity: number) => void;
  onUnmatched: (reason: string) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [storeId, setStoreId] = useState('');
  const [quantity, setQuantity] = useState(String(initialQuantity));
  const [reason, setReason] = useState('');
  const q = useDebounced(text.trim(), 350);
  const results = useApiQuery(queries.productSearch({ q, storeId: storeId || null }), {
    enabled: q.length >= 2,
  });

  const rows = useMemo(
    () =>
      results.data
        .map((product) => ({ product, km: roadKm(stores.get(product.storeId)?.location, site) }))
        .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)),
    [results.data, site, stores],
  );
  const qty = Math.max(1, Math.min(9999, Math.floor(Number(quantity) || 1)));

  return (
    <Card>
      <CardHeader
        title={requestLine === null ? 'Add a listing' : `Source line ${requestLine + 1}`}
        description={requestLine === null ? 'Search every live store.' : `“${initialText}”`}
        action={<IconButton icon={CloseIcon} label="Close the search" size="sm" onClick={onClose} />}
      />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_6rem]">
          <TextInput
            type="search"
            aria-label="Search listings"
            placeholder="2x4x8 SPF stud, 1/2 in drywall…"
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
          />
          <StoreSelect value={storeId} onChange={setStoreId} liveOnly allLabel="Any store" />
          <TextInput
            type="number"
            min={1}
            max={9999}
            aria-label="Quantity to add"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        {q.length < 2 ? (
          <p className="text-sm text-slate-500">Type at least two letters.</p>
        ) : results.loading && results.data.length === 0 ? (
          <Spinner label="Searching" />
        ) : results.error && results.data.length === 0 ? (
          <ErrorState error={results.error} onRetry={results.retry} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No listed product matches. Try other words, or add a special order.
          </p>
        ) : (
          <ul
            className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200"
            aria-label="Listings"
          >
            {rows.map(({ product, km }) => {
              const available = availableQty(product);
              return (
                <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                  <ItemThumb item={product} size="sm" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium text-slate-900">{product.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {product.storeName}
                      {km !== null ? ` · ${km.toFixed(1)} km` : ''} ·{' '}
                      {[product.sku, product.size].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium tabular-nums">{formatMoney(product.priceCents)}</p>
                    <p className={available < qty ? 'text-xs text-amber-700' : 'text-xs text-slate-500'}>
                      {available} in stock
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    icon={PlusIcon}
                    onClick={() => onAdd(product, qty)}
                    aria-label={`Add ${qty} × ${product.name} from ${product.storeName}`}
                  >
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <Button size="sm" variant="secondary" icon={PlusIcon} onClick={onCustom}>
            Special-order line
          </Button>
          {requestLine !== null ? (
            <>
              <Field label="Can't source it? Reason" className="min-w-48 flex-1">
                {(id) => (
                  <TextInput
                    id={id}
                    value={reason}
                    placeholder="Discontinued; no store in range carries it"
                    onChange={(event) => setReason(event.target.value)}
                  />
                )}
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={reason.trim().length < 3}
                onClick={() => onUnmatched(reason.trim())}
              >
                Mark unmatched
              </Button>
            </>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
