import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import { artDataUri } from '@instasupply/art';
import { LOW_STOCK_THRESHOLD, pluralize, type CategoryId, type Product } from '@instasupply/shared';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadMore } from '@/components/ui/Data';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Select, TextInput } from '@/components/ui/Form';
import { PlusIcon, SearchIcon } from '@/components/ui/icons';
import { Tabs } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { queries } from '@/lib/api';
import { cn } from '@/lib/cn';

import {
  EMPTY_FILTERS,
  matchesFilters,
  useFrozenRows,
  type CatalogFilters,
  type SortKey,
} from './catalog-model';
import { CategoriesTab } from './components/CategoriesTab';
import { ProductFormModal } from './components/ProductFormModal';
import { ProductTable } from './components/ProductTable';
import { useCategories } from './hooks';
import { deleteProduct } from './mutations';
import { useDialogState } from './ui-hooks';

type Tab = 'products' | 'categories';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'available', label: 'Available, lowest first' },
  { value: 'price', label: 'Price, lowest first' },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ring-1 transition-colors ring-inset',
        active
          ? 'bg-brand-50 text-brand-700 ring-brand-300'
          : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

/** Typing waits this long before an all-stores search goes to the server. */
const SEARCH_DELAY_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * The catalogue workspace (MARKETPLACE §8 `/portal/catalog`; shared with ops on `/catalog` and the
 * store page's Catalog tab, §9). With a `storeId` it works on that store's complete live catalogue
 * (`portalCatalog`) and filters on the page; staff without a store pick one or browse every store
 * through the paged ops catalogue, filtered by the server.
 *
 * Inline edits (price, on hand, for sale) never move or drop rows while you work (review: ux #1).
 */
export function CatalogWorkspace({
  storeId = null,
  staff = false,
  canDelete = false,
  categoriesTab = false,
}: {
  /** The store whose catalogue this is; null lets staff choose or see every store. */
  storeId?: string | null;
  /** InstaSupply staff: adds `featured`, `badge` and `familyKey`. */
  staff?: boolean;
  /** Store owners and admins may delete products that no open order holds. */
  canDelete?: boolean;
  /** Ops `/catalog`: a Categories tab to edit defaults and synonyms. */
  categoriesTab?: boolean;
}) {
  const toast = useToast();
  const categories = useCategories();
  const [tab, setTab] = useState<Tab>('products');
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [storeFilter, setStoreFilter] = useState('');
  const dialog = useDialogState<Product>();
  const [toDelete, setToDelete] = useState<Product | null>(null);

  const activeStore = storeId ?? (storeFilter || null);
  const pickStore = staff && storeId === null;
  const stores = useLiveQuery(queries.stores(), { enabled: pickStore });

  // One store: its whole catalogue, live, filtered here.
  const storeQuery = useMemo(() => queries.portalCatalog(activeStore), [activeStore]);
  const storeList = useLiveQuery(storeQuery);

  // Every store (staff): paged, filtered by the server.
  const q = useDebounced(filters.q.trim(), SEARCH_DELAY_MS);
  const serverQuery = useMemo(
    () =>
      queries.opsCatalog({
        categoryId: filters.categoryId || undefined,
        q: q || undefined,
        lowStock: filters.lowStock || undefined,
        active: filters.inactive ? false : undefined,
        estimated: filters.estimated || undefined,
      }),
    [filters.categoryId, filters.estimated, filters.inactive, filters.lowStock, q],
  );
  const allStores = usePagedQuery(serverQuery, { enabled: activeStore === null && staff });

  const complete = activeStore !== null;
  const source: readonly Product[] = complete ? storeList.data : allStores.items;
  const loading = complete ? storeList.loading : allStores.loading;
  const error = complete ? storeList.error : allStores.error;
  const retry = complete ? storeList.retry : allStores.retry;
  // The server already searched (with synonyms); on the page only the frozen order is applied.
  const rowFilters = complete ? filters : { ...filters, q: '' };
  const rows = useFrozenRows(source, rowFilters, complete ? `store:${activeStore}` : `all:${q}`);
  const matching = complete
    ? source.filter((product) => matchesFilters(product, filters)).length
    : rows.length;

  const set = (patch: Partial<CatalogFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const filtered =
    filters.q.trim() !== '' ||
    filters.categoryId !== '' ||
    filters.lowStock ||
    filters.inactive ||
    filters.estimated;
  const defaultCategory = (
    categories.data.some((item) => item.id === filters.categoryId) ? filters.categoryId : ''
  ) as CategoryId | '';

  const toolbar = (
    <div className="space-y-3 border-b border-slate-100 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <TextInput
            type="search"
            aria-label="Search products by name, SKU, brand or size"
            placeholder="Search name, SKU, brand or size"
            className="pl-9"
            value={filters.q}
            onChange={(event) => set({ q: event.target.value })}
          />
        </div>
        {pickStore ? (
          <Select
            aria-label="Store"
            className="w-auto min-w-48"
            value={storeFilter}
            onChange={(event) => setStoreFilter(event.target.value)}
          >
            <option value="">All stores</option>
            {stores.data.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          aria-label="Category"
          className="w-auto min-w-40"
          value={filters.categoryId}
          onChange={(event) => set({ categoryId: event.target.value })}
        >
          <option value="">All categories</option>
          {categories.data.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Sort"
          className="w-auto"
          value={filters.sort}
          onChange={(event) => set({ sort: event.target.value as SortKey })}
        >
          {SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <Chip active={filters.lowStock} onClick={() => set({ lowStock: !filters.lowStock })}>
          {`Low stock (under ${LOW_STOCK_THRESHOLD} available)`}
        </Chip>
        <Chip active={filters.inactive} onClick={() => set({ inactive: !filters.inactive })}>
          Not for sale
        </Chip>
        <Chip active={filters.estimated} onClick={() => set({ estimated: !filters.estimated })}>
          Estimated size
        </Chip>
        {filtered ? (
          <button
            type="button"
            className="text-xs font-medium text-brand-700 hover:underline"
            onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
          >
            Clear filters
          </button>
        ) : null}
        <span className="ml-auto text-xs text-slate-500" aria-live="polite">
          {complete
            ? `${matching} of ${pluralize(source.length, 'product')}`
            : `${pluralize(rows.length, 'product')} loaded${allStores.hasMore ? ', more below' : ''}`}
        </span>
      </div>
    </div>
  );

  const emptyArt = artDataUri('scene-local-suppliers');
  let body;
  if (loading && source.length === 0) {
    body = <PageSpinner label="Loading the catalogue" />;
  } else if (error && source.length === 0) {
    body = (
      <div className="p-5">
        <ErrorState error={error} onRetry={retry} />
      </div>
    );
  } else if (source.length === 0 && !filtered) {
    body = (
      <div className="flex flex-col items-center px-6 py-12 text-center">
        {emptyArt ? (
          <img src={emptyArt} alt="" aria-hidden className="mb-4 h-28 w-40 object-contain" />
        ) : null}
        <p className="text-sm font-semibold text-slate-900">No products yet</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Add the lumber, fasteners and fittings you stock. Contractors can order them as soon as they are for
          sale.
        </p>
        <Button className="mt-4" icon={PlusIcon} onClick={() => dialog.show(null)}>
          Add a product
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-semibold text-slate-900">No products match</p>
        <p className="mt-1 text-sm text-slate-500">Try another search or clear the filters.</p>
      </div>
    );
  } else {
    body = (
      <>
        {error ? (
          <div className="px-5 pt-4">
            <ErrorState title="The list may be out of date" error={error} onRetry={retry} />
          </div>
        ) : null}
        <ProductTable
          products={rows}
          listKey={complete ? storeQuery.key : null}
          showStore={!complete}
          staff={staff}
          canDelete={canDelete}
          onEdit={(product) => dialog.show(product)}
          onDelete={setToDelete}
        />
        {!complete ? (
          <LoadMore
            hasMore={allStores.hasMore}
            loadingMore={allStores.loadingMore}
            onLoadMore={allStores.loadMore}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {categoriesTab ? (
          <Tabs<Tab>
            ariaLabel="Catalogue"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'products', label: 'Products' },
              { value: 'categories', label: 'Categories', count: categories.data.length || undefined },
            ]}
          />
        ) : (
          <span />
        )}
        {tab === 'products' ? (
          <Button icon={PlusIcon} onClick={() => dialog.show(null)}>
            Add product
          </Button>
        ) : null}
      </div>

      {tab === 'categories' ? (
        <CategoriesTab />
      ) : (
        <Card className="overflow-hidden">
          {toolbar}
          {body}
        </Card>
      )}

      {dialog.open || dialog.session > 0 ? (
        <ProductFormModal
          key={dialog.session}
          open={dialog.open}
          onClose={dialog.close}
          product={dialog.data}
          storeId={activeStore}
          staff={staff}
          defaultCategoryId={defaultCategory}
          categories={categories.data}
        />
      ) : null}
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.name ?? 'this product'}?`}
        description="It disappears from the app and your catalogue. Past orders keep their copy of it. To stop selling it for a while, switch off “For sale” instead."
        confirmLabel="Delete product"
        tone="danger"
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteProduct(toDelete.id);
          toast.success(`Deleted ${toDelete.name}`);
        }}
      />
    </>
  );
}
