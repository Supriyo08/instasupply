import type { Category } from '@instasupply/shared';
import { useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { GridIcon, PlusIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import type { CollectionState } from '@/lib/firebase/hooks';
import { errorMessage } from '@/lib/firebase/callables';

import { countByCategory } from '../catalog-filters';
import { reorderCategories } from '../category-form';
import type { CategoryRecord, ProductRecord } from '../hooks';
import { saveCategoryOrder } from '../mutations';
import { useDialogState } from '../ui-hooks';
import { CategoryRow } from './CategoryRow';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

const NO_PRODUCTS = { active: 0, total: 0 };

export function CategoriesTab({
  categories,
  products,
  canDelete,
  onCreate,
  onEdit,
  onViewProducts,
}: {
  categories: CollectionState<Category>;
  products: ProductRecord[];
  canDelete: boolean;
  onCreate: () => void;
  onEdit: (category: CategoryRecord) => void;
  onViewProducts: (categoryId: string) => void;
}) {
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const deleting = useDialogState<CategoryRecord>();
  const counts = useMemo(() => countByCategory(products), [products]);
  const list = categories.data;

  const move = async (index: number, direction: -1 | 1) => {
    const updates = reorderCategories(list, index, direction);
    if (moving || updates.length === 0) return;
    setMoving(true);
    try {
      await saveCategoryOrder(updates);
    } catch (error) {
      toast.error("Couldn't reorder categories", errorMessage(error));
    } finally {
      setMoving(false);
    }
  };

  let content: ReactNode;
  if (categories.error) {
    content = <ErrorState error={categories.error} className="m-5" />;
  } else if (categories.loading && list.length === 0) {
    content = <PageSpinner label="Loading categories" />;
  } else if (list.length === 0) {
    content = (
      <EmptyState
        icon={GridIcon}
        title="No categories yet"
        description="Categories group products in the shop. Create one before adding products."
        action={
          <Button icon={PlusIcon} onClick={onCreate}>
            New category
          </Button>
        }
      />
    );
  } else {
    content = (
      <>
        <p className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
          The shop lists categories in this order. Use the arrows to move one up or down.
        </p>
        <ul className="divide-y divide-slate-100" aria-busy={moving || undefined}>
          {list.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              counts={counts.get(category.id) ?? NO_PRODUCTS}
              isFirst={index === 0}
              isLast={index === list.length - 1}
              moving={moving}
              canDelete={canDelete}
              onMove={(direction) => void move(index, direction)}
              onEdit={() => onEdit(category)}
              onDelete={() => deleting.show(category)}
              onViewProducts={() => onViewProducts(category.id)}
            />
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      {content}
      {canDelete ? (
        <DeleteCategoryDialog
          key={deleting.session}
          category={deleting.data}
          open={deleting.open}
          onClose={deleting.close}
        />
      ) : null}
    </>
  );
}
