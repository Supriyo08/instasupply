import { buildSearchTerms } from '@instasupply/shared';
import { useCallback, useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { InfoIcon, WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/firebase/callables';

import type { CategoryRecord, ProductRecord } from '../hooks';
import { createProduct, updateProduct, type ProductUpdate } from '../mutations';
import {
  emptyProductDraft,
  productChanges,
  productToDraft,
  productToValues,
  sameTerms,
  validateProductDraft,
  type ProductDraft,
  type ProductErrors,
} from '../product-form';
import { ProductFormFields } from './ProductFormFields';
import { ProductPreview } from './ProductPreview';

/**
 * Create a product (`product` null) or edit one. Mount with a fresh `key` per opening so the form
 * starts from the product as it is now.
 */
export function ProductFormModal({
  open,
  product,
  categories,
  knownIds,
  defaultCategoryId,
  onClose,
}: {
  open: boolean;
  product: ProductRecord | null;
  categories: CategoryRecord[];
  /** Product ids already in use, to pick a free id for a new product without extra reads. */
  knownIds: ReadonlySet<string>;
  defaultCategoryId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const [draft, setDraft] = useState<ProductDraft>(() =>
    product ? productToDraft(product) : emptyProductDraft(defaultCategoryId),
  );
  const [errors, setErrors] = useState<ProductErrors>({});
  const [saving, setSaving] = useState(false);

  const patch = useCallback(
    (change: Partial<ProductDraft>) => setDraft((current) => ({ ...current, ...change })),
    [],
  );
  const category = categories.find((item) => item.id === draft.categoryId) ?? null;

  const save = async () => {
    const result = validateProductDraft(draft, new Set(categories.map((item) => item.id)));
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const value = result.value;
    const categoryName = categories.find((item) => item.id === value.categoryId)?.name ?? value.categoryId;
    setErrors({});
    setSaving(true);
    try {
      if (product) {
        // Write only what changed, so stock sold while the form was open isn't overwritten.
        const changes: ProductUpdate = productChanges(productToValues(product), value);
        const searchTerms = buildSearchTerms(value.name, [categoryName, value.unit]);
        if (!sameTerms(product.searchTerms, searchTerms)) changes.searchTerms = searchTerms;
        if (Object.keys(changes).length === 0) {
          toast.info('No changes to save');
        } else {
          await updateProduct(product.id, changes);
          toast.success(`${value.name} saved`);
        }
      } else {
        await createProduct(value, categoryName, knownIds);
        toast.success(
          `${value.name} added`,
          !value.active
            ? 'It stays hidden until you make it active.'
            : value.stock > 0
              ? 'It is live in the shop now.'
              : 'It shows as sold out until you add stock.',
        );
      }
      onClose();
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={product ? `Edit ${product.name}` : 'New product'}
      description={
        product ? (
          <>
            ID <span className="font-mono text-xs">{product.id}</span>
          </>
        ) : (
          'Shoppers see it as soon as it is active and in stock.'
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {product ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="min-w-0 space-y-5">
          {errors.form ? (
            <Callout tone="warning" icon={WarningIcon}>
              {errors.form}
            </Callout>
          ) : null}
          {categories.length === 0 ? (
            <Callout tone="info" icon={InfoIcon} title="No categories yet">
              Every product belongs to a category. Create one on the Categories tab first.
            </Callout>
          ) : null}
          <ProductFormFields draft={draft} errors={errors} categories={categories} onChange={patch} />
        </div>
        <aside className="md:sticky md:top-0 md:self-start">
          <ProductPreview draft={draft} category={category} />
        </aside>
      </form>
    </Modal>
  );
}
