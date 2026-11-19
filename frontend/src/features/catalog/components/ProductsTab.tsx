import type { Product } from '@instasupply/shared';
import { useMemo, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { CatalogIcon, FilterIcon, PlusIcon } from '@/components/ui/icons';
import { indexById } from '@/lib/data';
import type { CollectionState } from '@/lib/firebase/hooks';

import { filterProducts, matchesStatus, sortProducts, summarize } from '../catalog-filters';
import type { CategoryRecord, ProductRecord } from '../hooks';
import { useDialogState, useMediaQuery } from '../ui-hooks';
import type { ProductFilters } from '../url-state';
import { DeleteProductDialog } from './DeleteProductDialog';
import { ProductCardList } from './ProductCardList';
import { ProductTable } from './ProductTable';
import { ProductFilterBar, SummaryChips } from './ProductToolbar';

const CLEARED: Partial<ProductFilters> = { q: '', category: '', status: 'all' };

export function ProductsTab({
  products,
  categories,
  filters,
  onFiltersChange,
  canDelete,
  onCreate,
  onEdit,
}: {
  products: CollectionState<Product>;
  categories: CategoryRecord[];
  filters: ProductFilters;
  onFiltersChange: (patch: Partial<ProductFilters>) => void;
  canDelete: boolean;
  onCreate: () => void;
  onEdit: (product: ProductRecord) => void;
}) {
  const wide = useMediaQuery('(min-width: 768px)');
  const deleting = useDialogState<ProductRecord>();
  const categoryById = useMemo(() => indexById(categories), [categories]);

  // Summary chips count within the search and category; the status filter then narrows the list.
  const scoped = useMemo(
    () => filterProducts(products.data, { search: filters.q, categoryId: filters.category }),
    [filters.category, filters.q, products.data],
  );
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const visible = useMemo(
    () =>
      sortProducts(
        scoped.filter((product) => matchesStatus(product, filters.status)),
        filters.sort,
      ),
    [filters.sort, filters.status, scoped],
  );

  const filtered = !!filters.q.trim() || !!filters.category || filters.status !== 'all';
  const Rows = wide ? ProductTable : ProductCardList;

  let content: ReactNode;
  if (products.error) {
    content = <ErrorState error={products.error} className="m-5" />;
  } else if (products.loading && products.data.length === 0) {
    content = <PageSpinner label="Loading products" />;
  } else if (products.data.length === 0) {
    content = (
      <EmptyState
        icon={CatalogIcon}
        title="No products yet"
        description="Add the first product to start selling in the shop."
        action={
          <Button icon={PlusIcon} onClick={onCreate}>
            New product
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={FilterIcon}
        title="No products match these filters"
        description="Try a different search, category or status."
        action={
          filtered ? (
            <Button variant="secondary" onClick={() => onFiltersChange(CLEARED)}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    content = (
      <Rows
        products={visible}
        categoryById={categoryById}
        canDelete={canDelete}
        onEdit={onEdit}
        onDelete={(product) => deleting.show(product)}
      />
    );
  }

  return (
    <>
      <ProductFilterBar filters={filters} categories={categories} onChange={onFiltersChange} />
      <SummaryChips
        summary={summary}
        status={filters.status}
        onSelect={(status) => onFiltersChange({ status })}
      />
      {content}
      {canDelete ? (
        <DeleteProductDialog
          key={deleting.session}
          product={deleting.data}
          category={deleting.data ? categoryById.get(deleting.data.categoryId) : undefined}
          open={deleting.open}
          onClose={deleting.close}
        />
      ) : null}
    </>
  );
}
