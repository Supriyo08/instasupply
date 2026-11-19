import { useMemo } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PlusIcon } from '@/components/ui/icons';
import { PageHeader, Tabs, type TabItem } from '@/components/ui/Layout';
import { useSignedInUser } from '@/features/auth/AuthProvider';

import { CategoriesTab } from './components/CategoriesTab';
import { CategoryFormModal } from './components/CategoryFormModal';
import { ProductFormModal } from './components/ProductFormModal';
import { ProductsTab } from './components/ProductsTab';
import { useCategories, useProducts, type CategoryRecord, type ProductRecord } from './hooks';
import { useDialogState } from './ui-hooks';
import { useCatalogParams, type CatalogTab } from './url-state';

export default function CatalogPage() {
  const { isAdmin } = useSignedInUser();
  const products = useProducts();
  const categories = useCategories();
  const { params, update } = useCatalogParams();
  const productDialog = useDialogState<ProductRecord>();
  const categoryDialog = useDialogState<CategoryRecord>();

  const knownIds = useMemo(() => new Set(products.data.map((product) => product.id)), [products.data]);
  const { tab, ...filters } = params;
  // New products start in the category being browsed.
  const defaultCategoryId = categories.data.some((category) => category.id === filters.category)
    ? filters.category
    : '';

  const tabs: TabItem<CatalogTab>[] = [
    {
      value: 'products',
      label: 'Products',
      count: products.loading && products.data.length === 0 ? undefined : products.data.length,
    },
    {
      value: 'categories',
      label: 'Categories',
      count: categories.loading && categories.data.length === 0 ? undefined : categories.data.length,
    },
  ];

  const newProduct = (
    <Button
      icon={PlusIcon}
      variant={tab === 'categories' ? 'secondary' : 'primary'}
      onClick={() => productDialog.show(null)}
    >
      New product
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Products, prices and stock in the shopping app."
        actions={
          tab === 'categories' ? (
            <>
              {newProduct}
              <Button icon={PlusIcon} onClick={() => categoryDialog.show(null)}>
                New category
              </Button>
            </>
          ) : (
            newProduct
          )
        }
      />

      <Card>
        <div className="px-4 pt-2 sm:px-5">
          <Tabs
            ariaLabel="Catalog sections"
            items={tabs}
            value={tab}
            onChange={(value) => update({ tab: value })}
          />
        </div>
        <div role="tabpanel" aria-label={tab === 'products' ? 'Products' : 'Categories'}>
          {tab === 'products' ? (
            <ProductsTab
              products={products}
              categories={categories.data}
              filters={filters}
              onFiltersChange={update}
              canDelete={isAdmin}
              onCreate={() => productDialog.show(null)}
              onEdit={(product) => productDialog.show(product)}
            />
          ) : (
            <CategoriesTab
              categories={categories}
              products={products.data}
              canDelete={isAdmin}
              onCreate={() => categoryDialog.show(null)}
              onEdit={(category) => categoryDialog.show(category)}
              onViewProducts={(categoryId) =>
                update({ tab: 'products', category: categoryId, q: '', status: 'all' })
              }
            />
          )}
        </div>
      </Card>

      <ProductFormModal
        key={productDialog.session}
        open={productDialog.open}
        product={productDialog.data}
        categories={categories.data}
        knownIds={knownIds}
        defaultCategoryId={defaultCategoryId}
        onClose={productDialog.close}
      />
      <CategoryFormModal
        key={categoryDialog.session}
        open={categoryDialog.open}
        category={categoryDialog.data}
        categories={categories.data}
        products={products.data}
        onClose={categoryDialog.close}
      />
    </>
  );
}
